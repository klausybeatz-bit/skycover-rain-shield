// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {PremiumMath} from "./libraries/PremiumMath.sol";

/**
 * @title SkyCoverInsurance
 * @notice Parametric rain insurance with an integrated liquidity pool.
 *
 *         A policy is bought by paying an ETH premium up front. Once the coverage
 *         window has ended the authorized oracle reports the total rainfall over
 *         that window. If the total is strictly below the policy threshold the
 *         holder can pull the coverage amount directly from the pool; otherwise
 *         the policy expires and its reserve is released.
 *
 *         Safety rules enforced on-chain:
 *         - Only the (rotatable) authorized oracle can submit rainfall reports.
 *         - Exactly one report per policy, and only after its window has ended.
 *         - A zero-millimetre report is a real report, not "missing data".
 *         - Out-of-range oracle values (e.g. absurd rainfall) are rejected.
 *         - A policy can claim at most once (duplicate-claim prevention).
 *         - A policy can only claim within CLAIM_WINDOW of the window ending.
 *         - A policy whose reserve was released can never be claimed (no underflow).
 *         - The pool can never pay out more than it holds.
 *         - Coverage reserved by live policies cannot be withdrawn by liquidity
 *           providers, and a new policy is rejected if the pool cannot cover it.
 *
 *         All arithmetic is integer-only (see PremiumMath) using basis points and
 *         an explicit rounding unit, so the premium matches the frontend quote.
 */
contract SkyCoverInsurance is Ownable, Pausable, ReentrancyGuard {
    struct Policy {
        address holder;
        string locationName;
        int256 latitude; // scaled by 1e2 (e.g. 2528 = 25.28)
        int256 longitude; // scaled by 1e2 (e.g. 9170 = 91.70)
        uint64 startDate; // unix seconds, inclusive, 00:00 UTC
        uint64 endDate; // unix seconds, inclusive, 00:00 UTC
        uint256 thresholdMm; // rainfall trigger, whole millimetres
        uint256 coverageWei; // amount paid out if the trigger is breached
        uint256 premiumWei; // amount paid in by the holder
        uint256 reportedRainfallMm; // valid only when hasReport is true
        bool hasReport;
        bool claimed;
        bool reservedReleased;
        bool exists;
    }

    // ------------------------------------------------------------------
    // Configuration bounds
    // ------------------------------------------------------------------

    uint256 public constant MIN_THRESHOLD_MM = 1;
    uint256 public constant MAX_THRESHOLD_MM = 5000;
    uint256 public constant MAX_COVERAGE_DAYS = 365;

    /// Hard cap on a single policy's coverage so no policy can be unbounded (R6).
    uint256 public constant MAX_COVERAGE_WEI = 10 ether;

    /// Upper bound on a plausible rainfall total; larger values are rejected as
    /// invalid oracle data (R6).
    uint256 public constant MAX_RAINFALL_MM = 10_000;

    /// The oracle may only report between endDate and endDate + this grace period.
    uint256 public constant REPORT_GRACE_PERIOD = 30 days;

    /// An eligible policy must be claimed within this window after endDate, after
    /// which its reserve becomes releasable (R4).
    uint256 public constant CLAIM_WINDOW = 180 days;

    /// Coordinate bounds, scaled by 1e2.
    int256 public constant MIN_LATITUDE = -9_000;
    int256 public constant MAX_LATITUDE = 9_000;
    int256 public constant MIN_LONGITUDE = -18_000;
    int256 public constant MAX_LONGITUDE = 18_000;

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    /// Authorized rainfall reporter. Rotatable by the owner.
    address public oracle;

    uint256 public nextPolicyId = 1;

    /// Total ETH held for the pool (premiums + provider deposits - payouts - withdrawals).
    uint256 public poolBalance;
    uint256 public premiumsCollected;
    uint256 public totalPayouts;

    /// Coverage that live policies could still claim. Providers may never withdraw
    /// liquidity that is reserved here.
    uint256 public totalReservedCoverage;

    mapping(uint256 => Policy) private _policies;
    mapping(address => uint256[]) private _holderPolicyIds;

    mapping(address => uint256) public providerShares;
    uint256 public totalShares;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event PolicyPurchased(
        uint256 indexed policyId,
        address indexed holder,
        uint256 premium,
        uint256 coverage,
        uint256 thresholdMm,
        uint64 startDate,
        uint64 endDate
    );
    event RainfallReported(uint256 indexed policyId, uint256 totalMm, bool eligible);
    event PayoutSent(uint256 indexed policyId, address indexed to, uint256 amount);
    event CoverageReleased(uint256 indexed policyId, uint256 amount);
    event PoolDeposit(address indexed provider, uint256 amount, uint256 shares);
    event PoolWithdraw(address indexed provider, uint256 amount, uint256 shares);
    event OracleRotated(address indexed previousOracle, address indexed newOracle);

    // ------------------------------------------------------------------
    // Custom errors
    // ------------------------------------------------------------------

    error NotOracle();
    error ZeroAddress();
    error EmptyLocation();
    error UnknownPolicy();
    error NotPolicyHolder();
    error InvalidWindow();
    error InvalidStartDate();
    error InvalidCoordinates();
    error InvalidThreshold();
    error CoverageTooLow();
    error CoverageTooHigh();
    error IncorrectPremium(uint256 expected, uint256 provided);
    error InvalidRainfall();
    error WindowNotEnded();
    error NoOracleReport();
    error RainMetThreshold();
    error AlreadyClaimed();
    error ClaimWindowClosed();
    error ReserveAlreadyReleased();
    error AlreadyReported();
    error ReportWindowClosed();
    error InsufficientPoolBalance();
    error InsufficientFreeLiquidity();
    error NothingToRelease();
    error ReleaseTooEarly();
    error EthTransferFailed();

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    /**
     * @param oracleAddress Authorized rainfall reporter.
     * @dev Any ETH sent at construction becomes seed liquidity, credited to the
     *      owner as pro-rata shares so it is accounted for fairly and can only be
     *      withdrawn when it is not reserved against live coverage (R2).
     */
    constructor(address oracleAddress) payable Ownable(msg.sender) {
        if (oracleAddress == address(0)) revert ZeroAddress();
        oracle = oracleAddress;

        uint256 seed = msg.value;
        if (seed > 0) {
            poolBalance = seed;
            providerShares[msg.sender] = seed;
            totalShares = seed;
            emit PoolDeposit(msg.sender, seed, seed);
        }
    }

    // ------------------------------------------------------------------
    // Owner controls
    // ------------------------------------------------------------------

    /// @notice Replace the reporting oracle. Existing policies are unaffected.
    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        emit OracleRotated(oracle, newOracle);
        oracle = newOracle;
    }

    /// @notice Halt purchases, claims, reports and pool movements in an emergency.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume normal operation.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------------------------------------
    // Premium
    // ------------------------------------------------------------------

    /// @notice Inclusive length of a coverage window in whole days.
    function coverageDays(uint64 startDate, uint64 endDate) public pure returns (uint256) {
        return (uint256(endDate) - uint256(startDate)) / 1 days + 1;
    }

    /**
     * @notice The exact ETH premium `purchasePolicy` requires. Exposed so the
     *         frontend can display and validate the same number the contract
     *         enforces, without duplicating the formula.
     */
    function requiredPremium(
        uint256 coverageWei,
        uint256 thresholdMm,
        uint64 startDate,
        uint64 endDate
    ) public pure returns (uint256) {
        // Only an inverted window is invalid; a single-day window (endDate ==
        // startDate) is legal and is quoted consistently with purchasePolicy.
        if (endDate < startDate) return 0;
        return PremiumMath.premiumWei(coverageWei, thresholdMm, coverageDays(startDate, endDate));
    }

    /// @notice Timestamp after which an unclaimed policy's reserve may be released.
    function claimDeadline(uint256 policyId) external view returns (uint256) {
        return uint256(_policies[policyId].endDate) + CLAIM_WINDOW;
    }

    // ------------------------------------------------------------------
    // Liquidity pool
    // ------------------------------------------------------------------

    /// @notice Liquidity that is not reserved against live policies and may leave.
    function freeLiquidity() public view returns (uint256) {
        return poolBalance > totalReservedCoverage ? poolBalance - totalReservedCoverage : 0;
    }

    /// @notice Supply liquidity and receive pro-rata shares of the pool.
    function deposit() external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert CoverageTooLow();
        uint256 shares = totalShares == 0 ? msg.value : (msg.value * totalShares) / poolBalance;
        poolBalance += msg.value;
        providerShares[msg.sender] += shares;
        totalShares += shares;
        emit PoolDeposit(msg.sender, msg.value, shares);
    }

    /**
     * @notice Withdraw liquidity by burning shares.
     * @dev Capped at free liquidity so a withdrawal can never consume coverage
     *      that live policies could still claim.
     */
    function withdraw(uint256 shares) external whenNotPaused nonReentrant {
        if (shares == 0 || shares > providerShares[msg.sender]) revert InsufficientPoolBalance();
        uint256 amount = (shares * poolBalance) / totalShares;
        if (amount > freeLiquidity()) revert InsufficientFreeLiquidity();

        providerShares[msg.sender] -= shares;
        totalShares -= shares;
        poolBalance -= amount;
        _safeTransferETH(msg.sender, amount);
        emit PoolWithdraw(msg.sender, amount, shares);
    }

    // ------------------------------------------------------------------
    // Policies
    // ------------------------------------------------------------------

    /**
     * @notice Purchase a policy by paying the exact premium up front.
     * @param coverageWei Payout the policy releases if the trigger is breached.
     * @dev Rejects the purchase if the pool (including the incoming premium)
     *      cannot cover the new coverage on top of everything already reserved,
     *      so an underfunded policy is never created (R1).
     */
    function purchasePolicy(
        string calldata locationName,
        int256 latitude,
        int256 longitude,
        uint64 startDate,
        uint64 endDate,
        uint256 thresholdMm,
        uint256 coverageWei
    ) external payable whenNotPaused nonReentrant returns (uint256 policyId) {
        if (bytes(locationName).length == 0) revert EmptyLocation();
        if (coverageWei == 0) revert CoverageTooLow();
        if (coverageWei > MAX_COVERAGE_WEI) revert CoverageTooHigh();
        if (latitude < MIN_LATITUDE || latitude > MAX_LATITUDE) revert InvalidCoordinates();
        if (longitude < MIN_LONGITUDE || longitude > MAX_LONGITUDE) revert InvalidCoordinates();
        if (thresholdMm < MIN_THRESHOLD_MM || thresholdMm > MAX_THRESHOLD_MM) {
            revert InvalidThreshold();
        }
        if (startDate < block.timestamp) revert InvalidStartDate();
        if (endDate < startDate) revert InvalidWindow();
        if (coverageDays(startDate, endDate) > MAX_COVERAGE_DAYS) revert InvalidWindow();

        uint256 expected = PremiumMath.premiumWei(
            coverageWei,
            thresholdMm,
            coverageDays(startDate, endDate)
        );
        if (msg.value != expected) revert IncorrectPremium(expected, msg.value);

        // R1: never create a policy the pool cannot pay out.
        if (poolBalance + msg.value < totalReservedCoverage + coverageWei) {
            revert InsufficientFreeLiquidity();
        }

        policyId = nextPolicyId++;
        _policies[policyId] = Policy({
            holder: msg.sender,
            locationName: locationName,
            latitude: latitude,
            longitude: longitude,
            startDate: startDate,
            endDate: endDate,
            thresholdMm: thresholdMm,
            coverageWei: coverageWei,
            premiumWei: msg.value,
            reportedRainfallMm: 0,
            hasReport: false,
            claimed: false,
            reservedReleased: false,
            exists: true
        });
        _holderPolicyIds[msg.sender].push(policyId);

        poolBalance += msg.value;
        premiumsCollected += msg.value;
        totalReservedCoverage += coverageWei;

        emit PolicyPurchased(
            policyId,
            msg.sender,
            msg.value,
            coverageWei,
            thresholdMm,
            startDate,
            endDate
        );
    }

    /// @notice The total rainfall (mm) the oracle reported for a policy, if any.
    function reportedRainfallMm(uint256 policyId) external view returns (uint256) {
        return _policies[policyId].reportedRainfallMm;
    }

    /// @notice Whether a policy has been evaluated by the oracle.
    function hasReport(uint256 policyId) external view returns (bool) {
        return _policies[policyId].hasReport;
    }

    /// @notice Read a full policy record.
    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return _policies[policyId];
    }

    /// @notice Number of policies ever created.
    function policyCount() external view returns (uint256) {
        return nextPolicyId - 1;
    }

    /// @notice Every policy id held by an address, oldest first.
    function policyIdsOf(address holder) external view returns (uint256[] memory) {
        return _holderPolicyIds[holder];
    }

    // ------------------------------------------------------------------
    // Oracle
    // ------------------------------------------------------------------

    /**
     * @notice Report the total rainfall (mm) recorded over a policy's window.
     * @dev Only between the window end and the end of the grace period. A report
     *      of 0 mm is a valid observation and is treated as "no rain", not as
     *      missing data — `hasReport` is what distinguishes the two. Values above
     *      MAX_RAINFALL_MM are rejected as invalid data (R6).
     */
    function reportRainfall(uint256 policyId, uint256 totalMm) external onlyOracle whenNotPaused {
        Policy storage p = _policies[policyId];
        if (!p.exists) revert UnknownPolicy();
        if (block.timestamp <= p.endDate) revert WindowNotEnded();
        if (p.hasReport) revert AlreadyReported();
        if (block.timestamp > uint256(p.endDate) + REPORT_GRACE_PERIOD) revert ReportWindowClosed();
        if (totalMm > MAX_RAINFALL_MM) revert InvalidRainfall();

        p.hasReport = true;
        p.reportedRainfallMm = totalMm;
        emit RainfallReported(policyId, totalMm, totalMm < p.thresholdMm);
    }

    // ------------------------------------------------------------------
    // Payout
    // ------------------------------------------------------------------

    /**
     * @notice The holder pulls the coverage for a policy that under-rained.
     * @dev Requires the window to have ended, a report below the threshold, an
     *      unclaimed and un-released policy, that the claim window is still open,
     *      and enough pool balance. Payable at most once.
     */
    function claimPayout(uint256 policyId) external whenNotPaused nonReentrant {
        Policy storage p = _policies[policyId];
        if (!p.exists) revert UnknownPolicy();
        if (msg.sender != p.holder) revert NotPolicyHolder();
        if (block.timestamp <= p.endDate) revert WindowNotEnded();
        if (!p.hasReport) revert NoOracleReport();
        if (p.reportedRainfallMm >= p.thresholdMm) revert RainMetThreshold();
        if (p.claimed) revert AlreadyClaimed();
        if (p.reservedReleased) revert ReserveAlreadyReleased();
        if (block.timestamp > uint256(p.endDate) + CLAIM_WINDOW) revert ClaimWindowClosed();
        if (poolBalance < p.coverageWei) revert InsufficientPoolBalance();

        p.claimed = true;
        totalReservedCoverage -= p.coverageWei;
        poolBalance -= p.coverageWei;
        totalPayouts += p.coverageWei;

        _safeTransferETH(p.holder, p.coverageWei);
        emit PayoutSent(policyId, p.holder, p.coverageWei);
    }

    /**
     * @notice Release the coverage reserve of a policy that can no longer pay out,
     *         so liquidity providers are not blocked by it.
     * @dev Releasable only when the policy is definitively unpayable (R3, R4):
     *      - the oracle reported rainfall at/above the threshold, or
     *      - an eligible policy was not claimed within CLAIM_WINDOW, or
     *      - the report grace period elapsed with no report at all.
     *      A claim that was already paid, or a reserve already released, is a no-op.
     *      Callable by anyone.
     */
    function releasePolicy(uint256 policyId) external whenNotPaused {
        Policy storage p = _policies[policyId];
        if (!p.exists) revert UnknownPolicy();
        if (p.claimed || p.reservedReleased) revert NothingToRelease();

        bool ineligible = p.hasReport && p.reportedRainfallMm >= p.thresholdMm;
        bool unclaimedExpired = p.hasReport &&
            p.reportedRainfallMm < p.thresholdMm &&
            block.timestamp > uint256(p.endDate) + CLAIM_WINDOW;
        bool unreported = !p.hasReport &&
            block.timestamp > uint256(p.endDate) + REPORT_GRACE_PERIOD;

        if (!ineligible && !unclaimedExpired && !unreported) revert ReleaseTooEarly();

        p.reservedReleased = true;
        totalReservedCoverage -= p.coverageWei;
        emit CoverageReleased(policyId, p.coverageWei);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function poolStats()
        external
        view
        returns (uint256 balance, uint256 premiums, uint256 payouts, uint256 reserved)
    {
        return (poolBalance, premiumsCollected, totalPayouts, totalReservedCoverage);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev Raw `call` (not `transfer`) so smart-contract holders can receive ETH,
    ///      guarded by nonReentrant everywhere it is used.
    function _safeTransferETH(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
