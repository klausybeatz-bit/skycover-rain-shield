import { describe, expect, it } from "vitest";

import { calculatePremium, coverageDays, isPayoutEligible } from "@/lib/premium";

describe("SkyCover premium + payout rules", () => {
  it("premium = coverage × 6% × (days/30) × (1 + threshold/200)", () => {
    // 0.1 ETH coverage, 30 days, 50 mm threshold:
    // 0.1 × 0.06 × 1 × 1.25 = 0.0075 ETH
    const b = calculatePremium(0.1, 50, 30);
    expect(b.premiumEth).toBe(0.0075);
    expect(b.dayFactor).toBe(1);
    expect(b.thresholdFactor).toBe(1.25);
  });

  it("premium scales linearly with coverage and duration", () => {
    const month = calculatePremium(0.2, 50, 30);
    const twoMonths = calculatePremium(0.2, 50, 60);
    expect(twoMonths.premiumEth).toBeCloseTo(month.premiumEth * 2, 6);
  });

  it("a policy is payout-eligible only when rainfall is strictly below the threshold", () => {
    expect(isPayoutEligible(19, 20)).toBe(true);
    expect(isPayoutEligible(20, 20)).toBe(false);
    expect(isPayoutEligible(25, 20)).toBe(false);
  });

  it("counts the coverage window inclusively in whole days", () => {
    expect(coverageDays("2026-06-01", "2026-06-01")).toBe(1);
    expect(coverageDays("2026-06-01", "2026-06-30")).toBe(30);
  });
});
