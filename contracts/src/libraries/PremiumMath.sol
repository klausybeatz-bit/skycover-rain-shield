// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title PremiumMath
 * @notice The single on-chain definition of the SkyCover premium formula.
 *
 *         It mirrors `src/lib/premium.ts` exactly so the frontend quote and the
 *         contract's required `msg.value` can never drift apart:
 *
 *           premium = coverage x baseRate x (days / 30) x (1 + thresholdMm / 200)
 *
 *         No floating point is used. The base rate is expressed in basis points
 *         and the threshold factor is expressed as an integer ratio, so the whole
 *         computation stays in uint256.
 */
library PremiumMath {
    /// 10_000 basis points = 100%.
    uint256 internal constant BASIS_POINTS = 10_000;

    /// 600 bp = 6.00% of coverage per 30-day period (BASE_RATE_PER_30_DAYS).
    uint256 internal constant BASE_RATE_BPS = 600;

    /// The base rate is quoted per 30 days of coverage.
    uint256 internal constant PERIOD_DAYS = 30;

    /// thresholdFactor = 1 + thresholdMm / 200, i.e. (200 + thresholdMm) / 200.
    uint256 internal constant THRESHOLD_SCALE_MM = 200;

    /// The frontend rounds the premium to 6 decimals of ETH (10^12 wei); the
    /// contract must round to the same unit or a valid quote would be rejected.
    uint256 internal constant ROUNDING_UNIT = 1e12;

    /// @notice Denominator of the whole formula: 10_000 * 30 * 200 = 60_000_000.
    uint256 internal constant DENOMINATOR = BASIS_POINTS * PERIOD_DAYS * THRESHOLD_SCALE_MM;

    /**
     * @notice Premium in wei for a coverage amount, rainfall threshold and window
     *         length, rounded to the nearest 1e-6 ETH (half-up at the rounding unit).
     * @param coverageWei Payout amount the policy would release, in wei.
     * @param thresholdMm Rainfall trigger threshold in whole millimetres.
     * @param days_ Inclusive length of the coverage window in days.
     */
    function premiumWei(
        uint256 coverageWei,
        uint256 thresholdMm,
        uint256 days_
    ) internal pure returns (uint256) {
        if (coverageWei == 0 || days_ == 0) return 0;

        uint256 numerator = coverageWei * BASE_RATE_BPS * days_ * (THRESHOLD_SCALE_MM + thresholdMm);
        uint256 scaled = DENOMINATOR * ROUNDING_UNIT;

        // Integer division truncates, so add half of the rounding unit first to
        // round half-up to the nearest 1e-6 ETH instead of always rounding down.
        uint256 units = (numerator + scaled / 2) / scaled;
        return units * ROUNDING_UNIT;
    }
}
