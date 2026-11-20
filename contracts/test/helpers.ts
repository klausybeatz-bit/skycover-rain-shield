import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/** Seconds in a day. */
export const DAY = 86_400;
export const REPORT_GRACE_PERIOD = 30 * DAY;
export const CLAIM_WINDOW = 180 * DAY;

/** Must mirror PremiumMath.ROUNDING_UNIT. */
export const ROUNDING_UNIT = 10n ** 12n;
export const MAX_COVERAGE_WEI = ethers.parseEther("10");
export const MAX_RAINFALL_MM = 10_000n;

/** A valid India location (Mumbai), coordinates scaled by 1e2. */
export const DEFAULT_COORDS = { latitude: 1907n, longitude: 7277n };

/** Midnight UTC tomorrow — the earliest start date the contract accepts. */
export async function nextMidnight(): Promise<number> {
  const now = await time.latest();
  return Math.floor(now / DAY) * DAY + DAY;
}

/** Jump to just after `timestamp`. */
export async function travelPast(timestamp: number): Promise<void> {
  await time.increaseTo(timestamp + 1);
}

/**
 * JavaScript reference implementation of the on-chain premium formula, used to
 * prove frontend/contract parity. Rounds half-up to the nearest 1e-6 ETH.
 */
export function referencePremiumWei(
  coverageWei: bigint,
  thresholdMm: bigint,
  days: number,
): bigint {
  if (coverageWei === 0n || days === 0) return 0n;
  const denominator = 10_000n * 30n * 200n; // 60_000_000
  const numerator = coverageWei * 600n * BigInt(days) * (200n + thresholdMm);
  const scaled = denominator * ROUNDING_UNIT;
  const units = (numerator + scaled / 2n) / scaled;
  return units * ROUNDING_UNIT;
}

export type Insurance = any;

/** Deploy a fresh SkyCoverInsurance with `seedEth` of owner-held seed liquidity. */
export async function deployInsurance(seedEth = "10") {
  const [owner, oracle, alice, bob, carol] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("SkyCoverInsurance");
  const insurance = await factory.deploy(oracle.address, {
    value: ethers.parseEther(seedEth),
  });
  await insurance.waitForDeployment();
  return { insurance: insurance as Insurance, owner, oracle, alice, bob, carol };
}

export type BuyOptions = {
  locationName?: string;
  latitude?: bigint;
  longitude?: bigint;
  startDate?: number;
  endDate?: number;
  thresholdMm?: bigint;
  coverageWei?: bigint;
  /** Override the ETH actually sent (to exercise IncorrectPremium). */
  premiumWei?: bigint;
};

/** Purchase a policy with sensible defaults (30-day window, 1 ETH coverage). */
export async function buy(insurance: Insurance, holder: any, options: BuyOptions = {}) {
  const startDate = options.startDate ?? (await nextMidnight());
  const endDate = options.endDate ?? startDate + 29 * DAY;
  const thresholdMm = options.thresholdMm ?? 50n;
  const coverageWei = options.coverageWei ?? ethers.parseEther("1");
  const premiumWei =
    options.premiumWei ??
    ((await insurance.requiredPremium(coverageWei, thresholdMm, startDate, endDate)) as bigint);

  return insurance.connect(holder).purchasePolicy(
    options.locationName ?? "Mumbai",
    options.latitude ?? DEFAULT_COORDS.latitude,
    options.longitude ?? DEFAULT_COORDS.longitude,
    startDate,
    endDate,
    thresholdMm,
    coverageWei,
    { value: premiumWei },
  );
}

/** Extract the policy id from a receipt's PolicyPurchased event. */
export async function policyIdFrom(insurance: Insurance, receipt: any): Promise<bigint> {
  for (const log of receipt.logs) {
    try {
      const parsed = insurance.interface.parseLog(log);
      if (parsed && parsed.name === "PolicyPurchased") {
        return parsed.args.policyId as bigint;
      }
    } catch {
      // Log emitted by another contract; ignore.
    }
  }
  throw new Error("PolicyPurchased event not found in receipt");
}

/** Buy a policy and return its id. */
export async function buyAndGetId(
  insurance: Insurance,
  holder: any,
  options: BuyOptions = {},
): Promise<bigint> {
  const tx = await buy(insurance, holder, options);
  const receipt = await tx.wait();
  return policyIdFrom(insurance, receipt);
}
