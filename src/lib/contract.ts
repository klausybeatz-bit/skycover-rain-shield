import {
  BrowserProvider,
  Contract,
  formatEther,
  parseEther,
  type ContractTransactionResponse,
  type Interface,
} from "ethers";

import { CONTRACTS, explorerTxUrl } from "./chain";

/**
 * On-chain bridge to SkyCoverInsurance.
 *
 * Every function here runs only in the browser, is called from a user action,
 * and lets MetaMask sign — no private key ever touches this code. While
 * CONTRACTS.insurance is null the app stays in labelled demo mode and these
 * helpers throw a descriptive error instead of sending anything.
 */

const INSURANCE_ABI = [
  "function purchasePolicy(string locationName, int256 latitude, int256 longitude, uint64 startDate, uint64 endDate, uint256 thresholdMm) payable returns (uint256 policyId)",
  "function claimPayout(uint256 policyId)",
  "function deposit() payable",
  "function withdraw(uint256 shares)",
  "function reportRainfall(uint256 policyId, uint256 totalMm)",
  "function poolStats() view returns (uint256 balance, uint256 premiums, uint256 payouts)",
  "function poolBalance() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function providerShares(address) view returns (uint256)",
  "event PolicyPurchased(uint256 indexed policyId, address indexed holder, uint256 premium, uint256 coverage, uint256 thresholdMm)",
];

/** The ethers Contract index signature hides the ABI methods from TypeScript. */
interface InsuranceContract {
  interface: Interface;
  purchasePolicy(
    locationName: string,
    latitude: number,
    longitude: number,
    startDate: bigint,
    endDate: bigint,
    thresholdMm: number,
    overrides?: { value: bigint },
  ): Promise<ContractTransactionResponse>;
  claimPayout(policyId: number): Promise<ContractTransactionResponse>;
  deposit(overrides?: { value: bigint }): Promise<ContractTransactionResponse>;
  withdraw(shares: bigint): Promise<ContractTransactionResponse>;
  reportRainfall(policyId: number, totalMm: number): Promise<ContractTransactionResponse>;
  poolStats(): Promise<[bigint, bigint, bigint]>;
  poolBalance(): Promise<bigint>;
  totalShares(): Promise<bigint>;
}

export interface OnchainResult {
  txHash: string;
  explorerUrl: string;
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function requireContractAddress(): string {
  if (!CONTRACTS.insurance) {
    throw new Error(
      "SkyCover insurance is not deployed yet. Deploy the contract to Sepolia and set CONTRACTS.insurance in src/lib/chain.ts.",
    );
  }
  return CONTRACTS.insurance;
}

function getEthereum(): Eip1193 {
  if (typeof window === "undefined") {
    throw new Error("Wallet actions are only available in the browser.");
  }
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) {
    throw new Error("MetaMask not detected. Install the MetaMask extension to transact on-chain.");
  }
  return eth;
}

async function getSignerContract(): Promise<InsuranceContract> {
  const address = requireContractAddress();
  const provider = new BrowserProvider(getEthereum());
  const signer = await provider.getSigner();
  return new Contract(address, INSURANCE_ABI, signer) as unknown as InsuranceContract;
}

async function getReadContract(): Promise<InsuranceContract> {
  const address = requireContractAddress();
  return new Contract(
    address,
    INSURANCE_ABI,
    new BrowserProvider(getEthereum()),
  ) as unknown as InsuranceContract;
}

/** The contract stores coordinates scaled by 1e2 (25.28 -> 2528). */
function toUnixSeconds(iso: string): bigint {
  return BigInt(Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000));
}

function toResult(hash: string): OnchainResult {
  return { txHash: hash, explorerUrl: explorerTxUrl(hash) };
}

async function confirm(tx: ContractTransactionResponse): Promise<OnchainResult> {
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Transaction was not mined.");
  return toResult(receipt.hash);
}

export async function purchasePolicyOnchain(input: {
  locationName: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  thresholdMm: number;
  premiumEth: number;
}): Promise<OnchainResult & { policyId: string }> {
  const contract = await getSignerContract();
  const tx = await contract.purchasePolicy(
    input.locationName,
    Math.round(input.latitude * 100),
    Math.round(input.longitude * 100),
    toUnixSeconds(input.startDate),
    toUnixSeconds(input.endDate),
    input.thresholdMm,
    { value: parseEther(String(input.premiumEth)) },
  );
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Transaction was not mined.");

  let policyId = "";
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "PolicyPurchased") {
        policyId = String(parsed.args[0]);
        break;
      }
    } catch {
      /* log emitted by a different contract — ignore */
    }
  }

  return { ...toResult(receipt.hash), policyId };
}

export async function claimPayoutOnchain(policyId: number): Promise<OnchainResult> {
  const contract = await getSignerContract();
  return confirm(await contract.claimPayout(policyId));
}

export async function depositPoolOnchain(amountEth: number): Promise<OnchainResult> {
  const contract = await getSignerContract();
  return confirm(await contract.deposit({ value: parseEther(String(amountEth)) }));
}

export async function withdrawPoolOnchain(amountEth: number): Promise<OnchainResult> {
  const read = await getReadContract();
  const [poolBalance, totalShares] = await Promise.all([read.poolBalance(), read.totalShares()]);
  if (totalShares === 0n || poolBalance === 0n) {
    throw new Error("The pool holds no liquidity to withdraw.");
  }

  const shares = (parseEther(String(amountEth)) * totalShares) / poolBalance;
  if (shares === 0n) throw new Error("Amount is too small to withdraw.");

  const contract = await getSignerContract();
  return confirm(await contract.withdraw(shares));
}

export async function reportRainfallOnchain(policyId: number, totalMm: number): Promise<OnchainResult> {
  const contract = await getSignerContract();
  return confirm(await contract.reportRainfall(policyId, totalMm));
}

export async function readPoolStats(): Promise<{
  balanceEth: number;
  premiumsEth: number;
  payoutsEth: number;
}> {
  const contract = await getReadContract();
  const [balance, premiums, payouts] = await contract.poolStats();
  return {
    balanceEth: Number(formatEther(balance)),
    premiumsEth: Number(formatEther(premiums)),
    payoutsEth: Number(formatEther(payouts)),
  };
}
