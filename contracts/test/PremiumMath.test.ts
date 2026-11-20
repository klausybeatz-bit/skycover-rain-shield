import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import {
  DAY,
  ROUNDING_UNIT,
  deployInsurance,
  nextMidnight,
  referencePremiumWei,
} from "./helpers";

describe("PremiumMath — parity with the frontend reference", () => {
  async function fixture() {
    return deployInsurance();
  }

  /** Aligned dates whose inclusive coverage length is exactly `days`. */
  async function datesFor(days: number) {
    const startDate = await nextMidnight();
    return { startDate, endDate: startDate + (days - 1) * DAY };
  }

  it("returns zero for zero coverage and for an inverted window", async () => {
    const { insurance } = await loadFixture(fixture);
    const { startDate, endDate } = await datesFor(30);

    expect(await insurance.requiredPremium(0n, 50n, startDate, endDate)).to.equal(0n);
    // endDate < startDate short-circuits to zero (mirrors the guard in purchasePolicy).
    expect(await insurance.requiredPremium(ethers.parseEther("1"), 50n, endDate, startDate)).to.equal(0n);
  });

  it("quotes a single-day window consistently (endDate == startDate)", async () => {
    const { insurance } = await loadFixture(fixture);
    const startDate = await nextMidnight();
    const coverage = ethers.parseEther("1");

    const actual = await insurance.requiredPremium(coverage, 50n, startDate, startDate);
    expect(actual).to.equal(referencePremiumWei(coverage, 50n, 1));
  });

  it("matches the reference formula for ordinary values", async () => {
    const { insurance } = await loadFixture(fixture);
    const { startDate, endDate } = await datesFor(30);
    const coverage = ethers.parseEther("1");

    const actual = await insurance.requiredPremium(coverage, 50n, startDate, endDate);
    expect(actual).to.equal(referencePremiumWei(coverage, 50n, 30));
    // Sanity: 1 ETH x 6% x (30/30) x (1 + 50/200) = 0.075 ETH.
    expect(actual).to.equal(ethers.parseEther("0.075"));
  });

  it("matches the reference formula for very small values", async () => {
    const { insurance } = await loadFixture(fixture);
    const { startDate, endDate } = await datesFor(1);

    const actual = await insurance.requiredPremium(1n, 1n, startDate, endDate);
    // 1 wei of coverage rounds down to zero at the 1e-6 ETH unit.
    expect(actual).to.equal(0n);
    expect(actual).to.equal(referencePremiumWei(1n, 1n, 1));
  });

  it("matches the reference formula for large values", async () => {
    const { insurance } = await loadFixture(fixture);
    const { startDate, endDate } = await datesFor(365);
    const coverage = ethers.parseEther("10"); // MAX_COVERAGE_WEI

    const actual = await insurance.requiredPremium(coverage, 5000n, startDate, endDate);
    expect(actual).to.equal(referencePremiumWei(coverage, 5000n, 365));
  });

  it("always returns a whole multiple of the 1e-6 ETH rounding unit", async () => {
    const { insurance } = await loadFixture(fixture);
    for (const days of [1, 7, 30, 365]) {
      const { startDate, endDate } = await datesFor(days);
      const actual = await insurance.requiredPremium(ethers.parseEther("0.3333"), 77n, startDate, endDate);
      expect(actual % ROUNDING_UNIT).to.equal(0n);
      expect(actual).to.equal(referencePremiumWei(ethers.parseEther("0.3333"), 77n, days));
    }
  });

  it("rounds half-up at the 1e-6 ETH boundary instead of truncating", async () => {
    const { insurance } = await loadFixture(fixture);
    const scaled = 60_000_000n * ROUNDING_UNIT;

    let sawRoundingThatMatters = false;
    const coverages = [1n, 300_000_000_000_000n, ethers.parseEther("1"), ethers.parseEther("10")];
    const thresholds = [7n, 50n];

    for (const days of [1, 30]) {
      const { startDate, endDate } = await datesFor(days);
      for (const coverage of coverages) {
        for (const threshold of thresholds) {
          const actual = await insurance.requiredPremium(coverage, threshold, startDate, endDate);
          const numerator = coverage * 600n * BigInt(days) * (200n + threshold);
          const truncated = (numerator / scaled) * ROUNDING_UNIT;
          const halfUp = ((numerator + scaled / 2n) / scaled) * ROUNDING_UNIT;

          expect(actual).to.equal(referencePremiumWei(coverage, threshold, days));
          expect(actual).to.equal(halfUp);

          if (halfUp !== truncated) {
            sawRoundingThatMatters = true;
          }
        }
      }
    }

    // Guarantees the grid actually exercised a value where rounding direction matters.
    expect(sawRoundingThatMatters).to.equal(true);
  });
});
