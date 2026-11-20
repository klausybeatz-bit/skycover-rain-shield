import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import {
  CLAIM_WINDOW,
  DAY,
  DEFAULT_COORDS,
  MAX_COVERAGE_WEI,
  MAX_RAINFALL_MM,
  buy,
  buyAndGetId,
  deployInsurance,
  nextMidnight,
  travelPast,
} from "./helpers";

describe("SkyCoverInsurance — policy lifecycle", () => {
  async function fixture() {
    return deployInsurance("10");
  }

  async function standardWindow() {
    const startDate = await nextMidnight();
    return { startDate, endDate: startDate + 29 * DAY };
  }

  /** Buy a policy, advance past its window, then have the oracle report `mm`. */
  async function boughtReportedPolicy(
    insurance: any,
    oracle: any,
    holder: any,
    mm: bigint,
    opts: { thresholdMm?: bigint; coverageWei?: bigint } = {},
  ) {
    const { startDate, endDate } = await standardWindow();
    const thresholdMm = opts.thresholdMm ?? 50n;
    const coverageWei = opts.coverageWei ?? ethers.parseEther("1");

    const policyId = await buyAndGetId(insurance, holder, {
      startDate,
      endDate,
      thresholdMm,
      coverageWei,
    });

    await travelPast(endDate);
    await insurance.connect(oracle).reportRainfall(policyId, mm);

    return { policyId, startDate, endDate, thresholdMm, coverageWei };
  }

  describe("purchase", () => {
    it("creates the policy and emits PolicyPurchased with all 7 fields", async () => {
      const { insurance, alice } = await loadFixture(fixture);
      const { startDate, endDate } = await standardWindow();
      const thresholdMm = 50n;
      const coverageWei = ethers.parseEther("1");
      const premium = await insurance.requiredPremium(coverageWei, thresholdMm, startDate, endDate);

      const tx = await buy(insurance, alice, { startDate, endDate, thresholdMm, coverageWei });

      await expect(tx)
        .to.emit(insurance, "PolicyPurchased")
        .withArgs(1n, alice.address, premium, coverageWei, thresholdMm, startDate, endDate);

      const policy = await insurance.getPolicy(1n);
      expect(policy.holder).to.equal(alice.address);
      expect(policy.locationName).to.equal("Mumbai");
      expect(policy.latitude).to.equal(DEFAULT_COORDS.latitude);
      expect(policy.longitude).to.equal(DEFAULT_COORDS.longitude);
      expect(policy.thresholdMm).to.equal(thresholdMm);
      expect(policy.coverageWei).to.equal(coverageWei);
      expect(policy.premiumWei).to.equal(premium);
      expect(policy.hasReport).to.equal(false);
      expect(policy.claimed).to.equal(false);
      expect(policy.reservedReleased).to.equal(false);
      expect(policy.exists).to.equal(true);

      expect(await insurance.policyCount()).to.equal(1n);
      expect(await insurance.policyIdsOf(alice.address)).to.deep.equal([1n]);
    });

    it("rejects a premium that does not match the required amount", async () => {
      const { insurance, alice } = await loadFixture(fixture);
      const { startDate, endDate } = await standardWindow();
      const coverageWei = ethers.parseEther("1");
      const premium = await insurance.requiredPremium(coverageWei, 50n, startDate, endDate);

      await expect(
        buy(insurance, alice, { startDate, endDate, coverageWei, premiumWei: premium - 1n }),
      ).to.be.revertedWithCustomError(insurance, "IncorrectPremium");

      await expect(
        buy(insurance, alice, { startDate, endDate, coverageWei, premiumWei: premium + 1n }),
      ).to.be.revertedWithCustomError(insurance, "IncorrectPremium");
    });

    it("rejects a start date in the past", async () => {
      const { insurance, alice } = await loadFixture(fixture);
      const startDate = (await nextMidnight()) - DAY; // midnight today, already elapsed
      await expect(
        buy(insurance, alice, { startDate, endDate: startDate + 29 * DAY }),
      ).to.be.revertedWithCustomError(insurance, "InvalidStartDate");
    });

    it("rejects a window that ends before it starts or is too long", async () => {
      const { insurance, alice } = await loadFixture(fixture);
      const { startDate } = await standardWindow();

      // endDate < startDate is inverted.
      await expect(
        buy(insurance, alice, { startDate, endDate: startDate - 1 }),
      ).to.be.revertedWithCustomError(insurance, "InvalidWindow");
      // 366 inclusive days > MAX_COVERAGE_DAYS (365).
      await expect(
        buy(insurance, alice, { startDate, endDate: startDate + 365 * DAY }),
      ).to.be.revertedWithCustomError(insurance, "InvalidWindow");
    });

    it("enforces the coverage bounds", async () => {
      const { insurance, alice } = await loadFixture(fixture);

      await expect(
        buy(insurance, alice, { coverageWei: 0n, premiumWei: 0n }),
      ).to.be.revertedWithCustomError(insurance, "CoverageTooLow");

      await expect(
        buy(insurance, alice, { coverageWei: MAX_COVERAGE_WEI + 1n }),
      ).to.be.revertedWithCustomError(insurance, "CoverageTooHigh");
    });

    it("rejects an out-of-range threshold", async () => {
      const { insurance, alice } = await loadFixture(fixture);

      await expect(buy(insurance, alice, { thresholdMm: 0n })).to.be.revertedWithCustomError(
        insurance,
        "InvalidThreshold",
      );
      await expect(buy(insurance, alice, { thresholdMm: 5001n })).to.be.revertedWithCustomError(
        insurance,
        "InvalidThreshold",
      );
    });

    it("rejects out-of-range coordinates and an empty location", async () => {
      const { insurance, alice } = await loadFixture(fixture);

      await expect(buy(insurance, alice, { latitude: 9001n })).to.be.revertedWithCustomError(
        insurance,
        "InvalidCoordinates",
      );
      await expect(buy(insurance, alice, { longitude: -18001n })).to.be.revertedWithCustomError(
        insurance,
        "InvalidCoordinates",
      );
      await expect(buy(insurance, alice, { locationName: "" })).to.be.revertedWithCustomError(
        insurance,
        "EmptyLocation",
      );
    });
  });

  describe("oracle reporting", () => {
    it("records a rainfall report and marks an under-threshold policy eligible", async () => {
      const { insurance, oracle, alice } = await loadFixture(fixture);
      const { startDate, endDate } = await standardWindow();
      const policyId = await buyAndGetId(insurance, alice, {
        startDate,
        endDate,
        thresholdMm: 50n,
      });

      await travelPast(endDate);
      await expect(insurance.connect(oracle).reportRainfall(policyId, 12n))
        .to.emit(insurance, "RainfallReported")
        .withArgs(policyId, 12n, true);

      expect(await insurance.hasReport(policyId)).to.equal(true);
      expect(await insurance.reportedRainfallMm(policyId)).to.equal(12n);
    });

    it("accepts a legitimate zero-rainfall report (0 mm is data, not missing)", async () => {
      const { insurance, oracle, alice } = await loadFixture(fixture);
      const { policyId } = await boughtReportedPolicy(insurance, oracle, alice, 0n);

      expect(await insurance.hasReport(policyId)).to.equal(true);
      expect(await insurance.reportedRainfallMm(policyId)).to.equal(0n);
    });

    it("rejects a duplicate report", async () => {
      const { insurance, oracle, alice } = await loadFixture(fixture);
      const { policyId } = await boughtReportedPolicy(insurance, oracle, alice, 10n);

      await expect(insurance.connect(oracle).reportRainfall(policyId, 20n)).to.be.revertedWithCustomError(
        insurance,
        "AlreadyReported",
      );
    });

    it("rejects a report before the window has ended", async () => {
      const { insurance, oracle, alice } = await loadFixture(fixture);
      const { startDate, endDate } = await standardWindow();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate });

      await expect(insurance.connect(oracle).reportRainfall(policyId, 5n)).to.be.revertedWithCustomError(
        insurance,
        "WindowNotEnded",
      );
    });

    it("rejects a report after the reporting grace period", async () => {
      const { insurance, oracle, alice } = await loadFixture(fixture);
      const { startDate, endDate } = await standardWindow();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate });

      await travelPast(endDate + 30 * DAY + 1);
      await expect(insurance.connect(oracle).reportRainfall(policyId, 5n)).to.be.revertedWithCustomError(
        insurance,
        "ReportWindowClosed",
      );
    });

    it("rejects implausibly large rainfall as invalid oracle data", async () => {
      const { insurance, oracle, alice } = await loadFixture(fixture);
      const { startDate, endDate } = await standardWindow();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate });

      await travelPast(endDate);
      await expect(
        insurance.connect(oracle).reportRainfall(policyId, MAX_RAINFALL_MM + 1n),
      ).to.be.revertedWithCustomError(insurance, "InvalidRainfall");
    });

    it("rejects a report from a non-oracle account", async () => {
      const { insurance, alice } = await loadFixture(fixture);
      const { startDate, endDate } = await standardWindow();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate });

      await travelPast(endDate);
      await expect(insurance.connect(alice).reportRainfall(policyId, 5n)).to.be.revertedWithCustomError(
        insurance,
        "NotOracle",
      );
    });

    it("rejects a report for an unknown policy", async () => {
      const { insurance, oracle } = await loadFixture(fixture);
      await expect(insurance.connect(oracle).reportRainfall(999n, 5n)).to.be.revertedWithCustomError(
        insurance,
        "UnknownPolicy",
      );
    });
  });

  describe("claim", () => {
    it("pays the coverage to the holder when rainfall is below the threshold", async () => {
      const { insurance, oracle, alice } = await loadFixture(fixture);
      const { policyId, coverageWei } = await boughtReportedPolicy(insurance, oracle, alice, 10n, {
        thresholdMm: 50n,
      });

      const before = await insurance.poolStats();
      const tx = await insurance.connect(alice).claimPayout(policyId);

      await expect(tx).to.emit(insurance, "PayoutSent").withArgs(policyId, alice.address, coverageWei);
      await expect(tx).to.changeEtherBalance(alice, coverageWei);

      const policy = await insurance.getPolicy(policyId);
      expect(policy.claimed).to.equal(true);

      const after = await insurance.poolStats();
      expect(after.reserved).to.equal(before.reserved - coverageWei);
      expect(after.payouts).to.equal(before.payouts + coverageWei);
    });

    it("rejects a claim when the reported rainfall met the threshold", async () => {
      const { insurance, oracle, alice } = await loadFixture(fixture);
      const { policyId } = await boughtReportedPolicy(insurance, oracle, alice, 50n, { thresholdMm: 50n });

      await expect(insurance.connect(alice).claimPayout(policyId)).to.be.revertedWithCustomError(
        insurance,
        "RainMetThreshold",
      );
    });

    it("rejects a claim before the oracle reported", async () => {
      const { insurance, alice } = await loadFixture(fixture);
      const { startDate, endDate } = await standardWindow();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate });

      await travelPast(endDate);
      await expect(insurance.connect(alice).claimPayout(policyId)).to.be.revertedWithCustomError(
        insurance,
        "NoOracleReport",
      );
    });

    it("rejects a duplicate claim", async () => {
      const { insurance, oracle, alice } = await loadFixture(fixture);
      const { policyId } = await boughtReportedPolicy(insurance, oracle, alice, 10n);

      await insurance.connect(alice).claimPayout(policyId);
      await expect(insurance.connect(alice).claimPayout(policyId)).to.be.revertedWithCustomError(
        insurance,
        "AlreadyClaimed",
      );
    });

    it("rejects a claim from anyone other than the holder", async () => {
      const { insurance, oracle, alice, bob } = await loadFixture(fixture);
      const { policyId } = await boughtReportedPolicy(insurance, oracle, alice, 10n);

      await expect(insurance.connect(bob).claimPayout(policyId)).to.be.revertedWithCustomError(
        insurance,
        "NotPolicyHolder",
      );
    });

    it("rejects a claim after the 180-day claim window", async () => {
      const { insurance, oracle, alice } = await loadFixture(fixture);
      const { policyId, endDate } = await boughtReportedPolicy(insurance, oracle, alice, 10n);

      await travelPast(endDate + CLAIM_WINDOW + 1);
      await expect(insurance.connect(alice).claimPayout(policyId)).to.be.revertedWithCustomError(
        insurance,
        "ClaimWindowClosed",
      );
    });

    it("exposes the claim deadline", async () => {
      const { insurance, alice } = await loadFixture(fixture);
      const { startDate, endDate } = await standardWindow();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate });

      expect(await insurance.claimDeadline(policyId)).to.equal(BigInt(endDate) + BigInt(CLAIM_WINDOW));
    });
  });
});
