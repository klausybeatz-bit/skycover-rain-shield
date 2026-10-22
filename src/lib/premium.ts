/**
 * Transparent premium + payout math. Pure and isomorphic so it can be unit
 * tested and reused by the buy form, demo flow, and (later) contract ABI
 * parameter checks.
 *
 * Premium = coverage × base rate × (days / 30) × threshold factor
 * - base rate: 6% of coverage per 30-day coverage period
 * - threshold factor: 1 + thresholdMm / 200 — a higher rainfall threshold is
 *   more likely to be breached, so it costs proportionally more.
 */

export const BASE_RATE_PER_30_DAYS = 0.06;

export interface PremiumBreakdown {
  coverageEth: number;
  thresholdMm: number;
  days: number;
  baseRate: number;
  dayFactor: number;
  thresholdFactor: number;
  premiumEth: number;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function calculatePremium(
  coverageEth: number,
  thresholdMm: number,
  days: number,
): PremiumBreakdown {
  const safeCoverage = Math.max(0, coverageEth);
  const safeDays = Math.max(1, days);
  const dayFactor = safeDays / 30;
  const thresholdFactor = 1 + Math.max(0, thresholdMm) / 200;
  const premiumEth = round6(safeCoverage * BASE_RATE_PER_30_DAYS * dayFactor * thresholdFactor);

  return {
    coverageEth: safeCoverage,
    thresholdMm,
    days: safeDays,
    baseRate: BASE_RATE_PER_30_DAYS,
    dayFactor: round6(dayFactor),
    thresholdFactor: round6(thresholdFactor),
    premiumEth,
  };
}

/**
 * Parametric payout rule: the policy pays out when TOTAL recorded rainfall
 * over the coverage window is strictly below the threshold. Rainfall equal to
 * or above the threshold means the covered activity was not rain-starved, so
 * no payout is due.
 */
export function isPayoutEligible(totalRainfallMm: number, thresholdMm: number): boolean {
  return totalRainfallMm < thresholdMm;
}

export function coverageDays(startISO: string, endISO: string): number {
  const start = new Date(`${startISO}T00:00:00Z`).getTime();
  const end = new Date(`${endISO}T00:00:00Z`).getTime();
  const days = Math.round((end - start) / 86_400_000) + 1;
  return Math.max(1, days);
}
