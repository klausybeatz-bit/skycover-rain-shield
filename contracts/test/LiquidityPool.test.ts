import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { DAY, buy, deployInsurance, nextMidnight } from "./helpers";

describe("SkyCoverInsurance — liquidity pool", () => {
  async function seeded() {
    return deployInsurance("10");
  }

  async function seededOne() {
    return deployInsurance("1");
  }

  async function empty() {
    return deployInsurance("0");
  }

  async function window30() {
    const startDate = await nextMidnight();
    return { startDate, endDate: startDate + 29 * DAY };
  }

  it("credits constructor seed liquidity to the owner as shares", async () => {
    const { insurance, owner } = await loadFixture(seeded);
    const seed = ethers.parseEther("10");

    const stats = await insurance.poolStats();
    expect(stats.balance).to.equal(seed);
    expect(await insurance.totalShares()).to.equal(seed);
    expect(await insurance.providerShares(owner.address)).to.equal(seed);
    expect(await insurance.freeLiquidity()).to.equal(seed);
  });

  it("mints pro-rata shares on deposit and returns funds on withdraw", async () => {
    const { insurance, bob } = await loadFixture(seeded);
    const deposit = ethers.parseEther("2");

    await insurance.connect(bob).deposit({ value: deposit });
    const shares = await insurance.providerShares(bob.address);
    expect(shares).to.equal(deposit);
    expect(await insurance.totalShares()).to.equal(ethers.parseEther("12"));

    await expect(insurance.connect(bob).withdraw(shares)).to.changeEtherBalance(bob, deposit);
    expect(await insurance.providerShares(bob.address)).to.equal(0n);
    expect((await insurance.poolStats()).balance).to.equal(ethers.parseEther("10"));
  });

  it("rejects a zero deposit and over-withdrawal", async () => {
    const { insurance, bob } = await loadFixture(seeded);

    await expect(insurance.connect(bob).deposit({ value: 0 })).to.be.revertedWithCustomError(
      insurance,
      "CoverageTooLow",
    );
    await expect(insurance.connect(bob).withdraw(1n)).to.be.revertedWithCustomError(
      insurance,
      "InsufficientPoolBalance",
    );
  });

  it("cannot withdraw liquidity reserved against live policies", async () => {
    const { insurance, owner, alice } = await loadFixture(seeded);
    const { startDate, endDate } = await window30();

    // 8 ETH of coverage against 10 ETH of seed liquidity.
    await buy(insurance, alice, { startDate, endDate, coverageWei: ethers.parseEther("8") });

    const stats = await insurance.poolStats();
    const reserved = BigInt(stats.reserved);
    const poolBalance = BigInt(stats.balance);
    expect(reserved).to.equal(ethers.parseEther("8"));
    expect(await insurance.freeLiquidity()).to.equal(poolBalance - reserved);

    const ownerShares = await insurance.providerShares(owner.address);
    await expect(insurance.connect(owner).withdraw(ownerShares)).to.be.revertedWithCustomError(
      insurance,
      "InsufficientFreeLiquidity",
    );

    // A withdrawal that stays inside free liquidity is still allowed.
    const partial = (poolBalance - reserved) / 2n;
    const totalShares = BigInt(await insurance.totalShares());
    const expected = (partial * poolBalance) / totalShares;
    await expect(insurance.connect(owner).withdraw(partial)).to.changeEtherBalance(owner, expected);
  });

  it("R1: rejects a purchase the empty pool cannot cover", async () => {
    const { insurance, alice } = await loadFixture(empty);

    await expect(
      buy(insurance, alice, { coverageWei: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(insurance, "InsufficientFreeLiquidity");
    expect(await insurance.policyCount()).to.equal(0n);
  });

  it("R1: rejects a second policy once the pool can no longer cover it", async () => {
    const { insurance, alice, bob } = await loadFixture(seededOne);

    // First policy: 1 ETH of coverage is exactly affordable against the 1 ETH seed.
    await buy(insurance, alice, { coverageWei: ethers.parseEther("1") });
    expect(await insurance.policyCount()).to.equal(1n);

    // Second policy: the first cover is already reserved, so this must fail.
    await expect(
      buy(insurance, bob, { coverageWei: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(insurance, "InsufficientFreeLiquidity");
    expect(await insurance.policyCount()).to.equal(1n);
  });

  it("tracks premiums, payouts and reserved coverage in poolStats", async () => {
    const { insurance, alice } = await loadFixture(seeded);
    const { startDate, endDate } = await window30();
    const coverageWei = ethers.parseEther("1");
    const premium = await insurance.requiredPremium(coverageWei, 50n, startDate, endDate);

    await buy(insurance, alice, { startDate, endDate, coverageWei });

    const stats = await insurance.poolStats();
    expect(stats.premiums).to.equal(premium);
    expect(stats.payouts).to.equal(0n);
    expect(stats.reserved).to.equal(coverageWei);
    expect(stats.balance).to.equal(ethers.parseEther("10") + premium);
    expect((await insurance.policyIdsOf(alice.address)).length).to.equal(1);
  });
});
