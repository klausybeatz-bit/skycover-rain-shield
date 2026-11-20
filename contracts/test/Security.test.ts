import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import {
  CLAIM_WINDOW,
  DAY,
  buy,
  buyAndGetId,
  deployInsurance,
  nextMidnight,
  travelPast,
} from "./helpers";

describe("SkyCoverInsurance — security & admin", () => {
  async function fixture() {
    return deployInsurance("10");
  }

  async function window30() {
    const startDate = await nextMidnight();
    return { startDate, endDate: startDate + 29 * DAY };
  }

  describe("pause / unpause", () => {
    it("is owner-only and blocks every state-changing entry point", async () => {
      const { insurance, owner, oracle, alice, bob } = await loadFixture(fixture);
      const { startDate, endDate } = await window30();
      const coverageWei = ethers.parseEther("1");
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate, coverageWei });

      await expect(insurance.connect(alice).pause()).to.be.revertedWithCustomError(
        insurance,
        "OwnableUnauthorizedAccount",
      );

      await insurance.connect(owner).pause();

      await expect(buy(insurance, bob, { coverageWei })).to.be.revertedWithCustomError(
        insurance,
        "EnforcedPause",
      );
      await expect(
        insurance.connect(bob).deposit({ value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(insurance, "EnforcedPause");
      await expect(
        insurance.connect(owner).withdraw(ethers.parseEther("1")),
      ).to.be.revertedWithCustomError(insurance, "EnforcedPause");
      await expect(
        insurance.connect(oracle).reportRainfall(policyId, 5n),
      ).to.be.revertedWithCustomError(insurance, "EnforcedPause");
      await expect(insurance.connect(alice).claimPayout(policyId)).to.be.revertedWithCustomError(
        insurance,
        "EnforcedPause",
      );
      await expect(insurance.connect(alice).releasePolicy(policyId)).to.be.revertedWithCustomError(
        insurance,
        "EnforcedPause",
      );

      await insurance.connect(owner).unpause();

      // Reporting works again after unpausing.
      await travelPast(endDate);
      await expect(insurance.connect(oracle).reportRainfall(policyId, 5n)).to.not.be.reverted;
    });
  });

  describe("oracle rotation", () => {
    it("rotates the oracle, revoking the old one and enabling the new one", async () => {
      const { insurance, owner, oracle, alice, carol } = await loadFixture(fixture);
      const { startDate, endDate } = await window30();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate });
      await travelPast(endDate);

      await expect(insurance.connect(owner).setOracle(carol.address))
        .to.emit(insurance, "OracleRotated")
        .withArgs(oracle.address, carol.address);
      expect(await insurance.oracle()).to.equal(carol.address);

      await expect(insurance.connect(oracle).reportRainfall(policyId, 5n)).to.be.revertedWithCustomError(
        insurance,
        "NotOracle",
      );
      await expect(insurance.connect(carol).reportRainfall(policyId, 5n)).to.not.be.reverted;
    });

    it("rejects a zero oracle and non-owner rotation", async () => {
      const { insurance, alice } = await loadFixture(fixture);

      await expect(
        insurance.connect(alice).setOracle(alice.address),
      ).to.be.revertedWithCustomError(insurance, "OwnableUnauthorizedAccount");
      await expect(insurance.setOracle(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        insurance,
        "ZeroAddress",
      );
    });
  });

  describe("reserve release (R3/R4/R5)", () => {
    it("releases the reserve of a reported-but-ineligible policy", async () => {
      const { insurance, oracle, alice, bob } = await loadFixture(fixture);
      const { startDate, endDate } = await window30();
      const coverageWei = ethers.parseEther("1");
      const policyId = await buyAndGetId(insurance, alice, {
        startDate,
        endDate,
        thresholdMm: 50n,
        coverageWei,
      });

      await travelPast(endDate);
      await insurance.connect(oracle).reportRainfall(policyId, 50n); // met threshold

      const before = await insurance.poolStats();
      await expect(insurance.connect(bob).releasePolicy(policyId))
        .to.emit(insurance, "CoverageReleased")
        .withArgs(policyId, coverageWei);

      const after = await insurance.poolStats();
      expect(after.reserved).to.equal(before.reserved - coverageWei);
      expect((await insurance.getPolicy(policyId)).reservedReleased).to.equal(true);
    });

    it("releases a policy that was never reported after the grace period", async () => {
      const { insurance, alice, bob } = await loadFixture(fixture);
      const { startDate, endDate } = await window30();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate });

      await travelPast(endDate + 30 * DAY + 1);
      await expect(insurance.connect(bob).releasePolicy(policyId)).to.emit(insurance, "CoverageReleased");
    });

    it("refuses to release an eligible policy while its claim is still valid", async () => {
      const { insurance, oracle, alice, bob } = await loadFixture(fixture);
      const { startDate, endDate } = await window30();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate, thresholdMm: 50n });

      await travelPast(endDate);
      await insurance.connect(oracle).reportRainfall(policyId, 10n); // eligible

      await expect(insurance.connect(bob).releasePolicy(policyId)).to.be.revertedWithCustomError(
        insurance,
        "ReleaseTooEarly",
      );
    });

    it("releases an eligible policy after the 180-day claim window expires", async () => {
      const { insurance, oracle, alice, bob } = await loadFixture(fixture);
      const { startDate, endDate } = await window30();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate, thresholdMm: 50n });

      await travelPast(endDate);
      await insurance.connect(oracle).reportRainfall(policyId, 10n); // eligible

      await travelPast(endDate + CLAIM_WINDOW + 1);
      await expect(insurance.connect(bob).releasePolicy(policyId)).to.emit(insurance, "CoverageReleased");
    });

    it("R5: a released reserve can never be claimed (no underflow)", async () => {
      const { insurance, oracle, alice, bob } = await loadFixture(fixture);
      const { startDate, endDate } = await window30();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate, thresholdMm: 50n });

      await travelPast(endDate);
      await insurance.connect(oracle).reportRainfall(policyId, 10n); // eligible
      await travelPast(endDate + CLAIM_WINDOW + 1);
      await insurance.connect(bob).releasePolicy(policyId);

      await expect(insurance.connect(alice).claimPayout(policyId)).to.be.revertedWithCustomError(
        insurance,
        "ReserveAlreadyReleased",
      );
    });

    it("is a no-op for an already-released policy", async () => {
      const { insurance, alice, bob } = await loadFixture(fixture);
      const { startDate, endDate } = await window30();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate });

      await travelPast(endDate + 30 * DAY + 1);
      await insurance.connect(bob).releasePolicy(policyId);
      await expect(insurance.connect(bob).releasePolicy(policyId)).to.be.revertedWithCustomError(
        insurance,
        "NothingToRelease",
      );
    });

    it("is a no-op for an already-claimed policy", async () => {
      const { insurance, oracle, alice, bob } = await loadFixture(fixture);
      const { startDate, endDate } = await window30();
      const policyId = await buyAndGetId(insurance, alice, { startDate, endDate, thresholdMm: 50n });

      await travelPast(endDate);
      await insurance.connect(oracle).reportRainfall(policyId, 10n); // eligible
      await insurance.connect(alice).claimPayout(policyId);

      await expect(insurance.connect(bob).releasePolicy(policyId)).to.be.revertedWithCustomError(
        insurance,
        "NothingToRelease",
      );
    });

    it("rejects release for an unknown policy", async () => {
      const { insurance, bob } = await loadFixture(fixture);
      await expect(insurance.connect(bob).releasePolicy(999n)).to.be.revertedWithCustomError(
        insurance,
        "UnknownPolicy",
      );
    });
  });

  describe("reentrancy", () => {
    it("the payout cannot be drained by a reentrant holder", async () => {
      const { insurance, oracle } = await loadFixture(fixture);
      const { startDate, endDate } = await window30();
      const coverageWei = ethers.parseEther("1");
      const premium = await insurance.requiredPremium(coverageWei, 50n, startDate, endDate);

      const holderFactory = await ethers.getContractFactory("ReentrantHolder");
      const attacker = await holderFactory.deploy(await insurance.getAddress());
      await attacker.waitForDeployment();
      const attackerAddress = await attacker.getAddress();

      await attacker.buy("Mumbai", 1907n, 7277n, startDate, endDate, 50n, coverageWei, {
        value: premium,
      });
      const policyId = await attacker.policyId();

      await travelPast(endDate);
      await insurance.connect(oracle).reportRainfall(policyId, 5n); // eligible

      const tx = await attacker.claim();
      await expect(tx).to.changeEtherBalance(attackerAddress, coverageWei);

      // The mid-transfer re-entry was attempted exactly once and blocked.
      expect(await attacker.reentryAttempts()).to.equal(1n);
      // Exactly one payout was made.
      expect((await insurance.poolStats()).payouts).to.equal(coverageWei);
      expect((await insurance.getPolicy(policyId)).claimed).to.equal(true);
    });
  });
});
