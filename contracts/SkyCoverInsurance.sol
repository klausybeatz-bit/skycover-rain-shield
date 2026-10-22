// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title SkyCoverInsurance
 * @notice Parametric rain insurance with an integrated liquidity pool.
 *         This is the reference contract for the SkyCover prototype. It is NOT
 *         deployed yet — when deployed to Sepolia, paste its address into
 *         src/lib/chain.ts and the frontend switches from demo mode to real
 *         on-chain transactions.
 *
 *         Safety rules enforced on-chain:
 *         - Only the authorized oracle can submit rainfall reports.
 *         - A policy pays out only when the reported total rainfall over its
 *           coverage window is strictly below the policy threshold.
 *         - A policy can claim at most once (duplicate-claim prevention).
 *         - The pool never pays more than its balance.
 */
contract SkyCoverInsurance {
    struct Policy {
        address holder;
        string locationName;
        int256 latitude;
        int256 longitude; // scaled by 1e2 (e.g. 2528 = 25.28)
        uint64 startDate;
        uint64 endDate;
        uint256 thresholdMm;
        uint256 coverageWei;
        uint256 premiumWei;
        bool claimed;
        bool exists;
    }

    address public immutable oracle;
    address public owner;

    uint256 public nextPolicyId = 1;
    uint256 public poolBalance;
    uint256 public premiumsCollected;
    uint256 public totalPayouts;

    mapping(uint256 => Policy) public policies;
    mapping(uint256 => uint256) public reportedRainfallMm; // policyId -> total mm
    mapping(address => uint256) public providerShares; // simple share accounting
    uint256 public totalShares;

    event PolicyPurchased(uint256 indexed policyId, address indexed holder, uint256 premium, uint256 coverage, uint256 thresholdMm);
    event RainfallReported(uint256 indexed policyId, uint256 totalMm, bool eligible);
    event PayoutSent(uint256 indexed policyId, address indexed to, uint256 amount);
    event PoolDeposit(address indexed provider, uint256 amount, uint256 shares);
    event PoolWithdraw(address indexed provider, uint256 amount, uint256 shares);

    error NotOracle();
    error NotOwner();
    error NotPolicyHolder();
    error UnknownPolicy();
    error WindowNotEnded();
    error NoOracleReport();
    error RainMetThreshold();
    error AlreadyClaimed();
    error InsufficientPoolBalance();
    error PremiumTooLow();
    error InvalidWindow();

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address oracleAddress) payable {
        oracle = oracleAddress;
        owner = msg.sender;
        poolBalance += msg.value;
    }

    // ------------------------------------------------------------------
    // Liquidity pool
    // ------------------------------------------------------------------

    /// @notice Supply liquidity and receive pro-rata shares of the pool.
    function deposit() external payable {
        if (msg.value == 0) revert PremiumTooLow();
        uint256 shares = totalShares == 0
            ? msg.value
            : (msg.value * totalShares) / (poolBalance);
        poolBalance += msg.value;
        providerShares[msg.sender] += shares;
        totalShares += shares;
        emit PoolDeposit(msg.sender, msg.value, shares);
    }

    /// @notice Withdraw up to your share of the pool.
    function withdraw(uint256 shares) external {
        if (shares == 0 || shares > providerShares[msg.sender]) revert InsufficientPoolBalance();
        uint256 amount = (shares * poolBalance) / totalShares;
        providerShares[msg.sender] -= shares;
        totalShares -= shares;
        poolBalance -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok);
        emit PoolWithdraw(msg.sender, amount, shares);
    }

    // ------------------------------------------------------------------
    // Policies
    // ------------------------------------------------------------------

    /// @notice Purchase a policy by paying the premium up front.
    function purchasePolicy(
        string calldata locationName,
        int256 latitude,
        int256 longitude,
        uint64 startDate,
        uint64 endDate,
        uint256 thresholdMm
    ) external payable returns (uint256 policyId) {
        if (msg.value == 0) revert PremiumTooLow();
        if (endDate <= startDate) revert InvalidWindow();

        policyId = nextPolicyId++;
        policies[policyId] = Policy({
            holder: msg.sender,
            locationName: locationName,
            latitude: latitude,
            longitude: longitude,
            startDate: startDate,
            endDate: endDate,
            thresholdMm: thresholdMm,
            coverageWei: msg.value * 10, // fixed 10x leverage for the prototype
            premiumWei: msg.value,
            claimed: false,
            exists: true
        });

        poolBalance += msg.value;
        premiumsCollected += msg.value;
        emit PolicyPurchased(policyId, msg.sender, msg.value, msg.value * 10, thresholdMm);
    }

    // ------------------------------------------------------------------
    // Oracle
    // ------------------------------------------------------------------

    /// @notice The authorized oracle reports total rainfall (mm) for a policy window.
    function reportRainfall(uint256 policyId, uint256 totalMm) external onlyOracle {
        if (!policies[policyId].exists) revert UnknownPolicy();
        reportedRainfallMm[policyId] = totalMm;
        emit RainfallReported(policyId, totalMm, totalMm < policies[policyId].thresholdMm);
    }

    /// @notice The policy holder claims once, after the window ended and the oracle reported.
    function claimPayout(uint256 policyId) external {
        Policy storage p = policies[policyId];
        if (!p.exists) revert UnknownPolicy();
        if (msg.sender != p.holder) revert NotPolicyHolder();
        if (block.timestamp <= p.endDate) revert WindowNotEnded();
        if (reportedRainfallMm[policyId] == 0) revert NoOracleReport();
        if (reportedRainfallMm[policyId] >= p.thresholdMm) revert RainMetThreshold();
        if (p.claimed) revert AlreadyClaimed(); // duplicate-claim prevention
        if (poolBalance < p.coverageWei) revert InsufficientPoolBalance();

        p.claimed = true;
        poolBalance -= p.coverageWei;
        totalPayouts += p.coverageWei;

        (bool ok, ) = p.holder.call{value: p.coverageWei}("");
        require(ok);
        emit PayoutSent(policyId, p.holder, p.coverageWei);
    }

    function poolStats()
        external
        view
        returns (uint256 balance, uint256 premiums, uint256 payouts)
    {
        return (poolBalance, premiumsCollected, totalPayouts);
    }
}
