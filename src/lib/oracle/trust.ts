/**
 * The trusted verification layer between live data and the blockchain.
 *
 * TinyFish is a web-data acquisition service, not a consensus oracle: a scraped
 * page — or a model's reading of one — may never authorise a payout. So the path
 * to SkyCoverInsurance is deliberately narrow:
 *
 *   1. a reading is taken from the structured series (see ./weather.ts);
 *   2. it is checked against the policy's own location, window and units here;
 *   3. it is submitted *by the authorised oracle account*, which the contract
 *      authenticates with its existing `onlyOracle` check — the same mechanism
 *      the contract already had, not a new one;
 *   4. only then can the contract run its payout condition.
 *
 * Nothing in this file trusts a forecast, a market price, or a number that
 * failed validation. Market prices never reach this code at all.
 *
 * Server-only: it reads the oracle signing key from the environment.
 */

import { CONTRACTS, explorerTxUrl, SEPOLIA_CHAIN_ID } from "../chain";
import type { WeatherIssue, WeatherSnapshot } from "./types";
import { MAX_WINDOW_MM } from "./validate";
import { toContractMm } from "./units";

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

/** The on-chain facts a report must agree with, taken from the policy. */
export interface ClaimWindow {
  startDate: string;
  endDate: string;
  latitude: number;
  longitude: number;
}

export type ClaimBlockReason =
  | "window-mismatch"
  | "location-mismatch"
  | "not-claim-grade"
  | "no-observed-total"
  | "forecast-in-total"
  | "unit-not-mm"
  | "above-contract-max";

export interface ClaimAuthorisation {
  /** True only when the reading may be submitted to the contract. */
  authorised: boolean;
  /** Whole millimetres for reportRainfall, or null when not authorised. */
  totalMm: number | null;
  /** Every reason the reading was refused. */
  blockedBy: ClaimBlockReason[];
  /** Weather-quality issue codes behind a refusal, for the audit trail. */
  qualityIssues: WeatherIssue[];
  /** What was actually measured, so a refusal can be explained. */
  observed: {
    windowTotalMm: number | null;
    observedThrough: string | null;
    sources: string[];
  };
}

/** Coordinates are compared at the contract's own 1e-2 precision. */
const COORDINATE_EPSILON = 0.011;

function coordinatesMatch(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): boolean {
  return (
    Math.abs(a.latitude - b.latitude) <= COORDINATE_EPSILON &&
    Math.abs(a.longitude - b.longitude) <= COORDINATE_EPSILON
  );
}

/**
 * Decide whether a snapshot may be reported for a policy.
 *
 * This is the single gate: if it does not return `authorised: true`, nothing is
 * sent on-chain. It never repairs or substitutes a value.
 */
export function authoriseClaimReport(
  snapshot: WeatherSnapshot,
  expected: ClaimWindow,
): ClaimAuthorisation {
  const blockedBy: ClaimBlockReason[] = [];

  if (
    snapshot.window === null ||
    snapshot.window.startDate !== expected.startDate ||
    snapshot.window.endDate !== expected.endDate
  ) {
    blockedBy.push("window-mismatch");
  }

  if (
    !coordinatesMatch(
      { latitude: expected.latitude, longitude: expected.longitude },
      { latitude: snapshot.location.latitude, longitude: snapshot.location.longitude },
    )
  ) {
    blockedBy.push("location-mismatch");
  }

  if (snapshot.unit !== "mm") blockedBy.push("unit-not-mm");
  if (!snapshot.quality.claimGrade) blockedBy.push("not-claim-grade");
  if (snapshot.windowTotalMm === null) blockedBy.push("no-observed-total");
  if (snapshot.quality.containsForecast) blockedBy.push("forecast-in-total");

  let totalMm: number | null = null;
  if (snapshot.windowTotalMm !== null) {
    const rounded = toContractMm(snapshot.windowTotalMm);
    if (rounded > MAX_WINDOW_MM) {
      blockedBy.push("above-contract-max");
    } else {
      totalMm = rounded;
    }
  }

  return {
    authorised: blockedBy.length === 0,
    totalMm: blockedBy.length === 0 ? totalMm : null,
    blockedBy,
    qualityIssues: snapshot.quality.issues,
    observed: {
      windowTotalMm: snapshot.windowTotalMm,
      observedThrough: snapshot.observedThrough,
      sources: snapshot.sources.map((source) => source.url),
    },
  };
}

/** Human-readable explanation of a refusal, for logs and the UI. */
export function describeClaimBlock(reason: ClaimBlockReason): string {
  switch (reason) {
    case "window-mismatch":
      return "The reading covers a different date window than the policy.";
    case "location-mismatch":
      return "The reading is for a different location than the policy.";
    case "not-claim-grade":
      return "The reading did not pass quality checks (see the issue list).";
    case "no-observed-total":
      return "No observed rainfall total is available for the window.";
    case "forecast-in-total":
      return "The reading contains forecast rainfall, which cannot back a claim.";
    case "unit-not-mm":
      return "The reading is not in millimetres.";
    case "above-contract-max":
      return `The total exceeds the contract's maximum of ${MAX_WINDOW_MM} mm.`;
  }
}

// ---------------------------------------------------------------------------
// Oracle reporting
// ---------------------------------------------------------------------------

export const ORACLE_PRIVATE_KEY_VAR = "ORACLE_PRIVATE_KEY";
export const ORACLE_RPC_URL_VAR = "SEPOLIA_RPC_URL";
export const ORACLE_CONTRACT_VAR = "SKYCOVER_INSURANCE_ADDRESS";

export interface OracleReportConfig {
  /** True when a signed report can actually be sent. */
  enabled: boolean;
  /** Variable *names* that are unset. Never values. */
  missing: string[];
  contractAddress: string | null;
  rpcUrl: string | null;
  chainId: number;
  /** The oracle account address, when a key is present. Never the key itself. */
  oracleAddress: string | null;
}

function readEnv(name: string): string | undefined {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length > 0 ? value : undefined;
}

/** True for a well-formed 32-byte hex private key. */
function isUsablePrivateKey(privateKey: string | undefined): boolean {
  return privateKey !== undefined && /^0x[0-9a-fA-F]{64}$/.test(privateKey);
}

export function getOracleReportConfig(): OracleReportConfig {
  const contractAddress = readEnv(ORACLE_CONTRACT_VAR) ?? CONTRACTS.insurance ?? null;
  const rpcUrl = readEnv(ORACLE_RPC_URL_VAR) ?? null;
  const privateKey = readEnv(ORACLE_PRIVATE_KEY_VAR);

  const missing: string[] = [];
  if (!contractAddress) missing.push(ORACLE_CONTRACT_VAR);
  if (!rpcUrl) missing.push(ORACLE_RPC_URL_VAR);
  if (!isUsablePrivateKey(privateKey)) missing.push(ORACLE_PRIVATE_KEY_VAR);

  return {
    enabled: missing.length === 0,
    missing,
    contractAddress,
    rpcUrl,
    chainId: SEPOLIA_CHAIN_ID,
    // The signer address is only ever learned from the wallet at submit time,
    // so no fragment of the private key is ever surfaced here.
    oracleAddress: null,
  };
}

/** What the transport must be able to do; ethers implements this shape. */
export interface OracleTransport {
  reportRainfall(
    policyId: number,
    totalMm: number,
  ): Promise<{ hash: string; wait(): Promise<{ hash: string } | null> }>;
}

export interface OracleReportOutcome {
  /** True only when a transaction was mined. */
  submitted: boolean;
  txHash: string | null;
  explorerUrl: string | null;
  /** Why nothing was submitted, when submitted is false. */
  reason: string | null;
  authorisation: ClaimAuthorisation;
  /** The oracle account that signed, when one was used. Never the key. */
  oracle: string | null;
}

async function buildEthersTransport(config: OracleReportConfig): Promise<{
  transport: OracleTransport;
  oracle: string;
}> {
  // Imported lazily so that a deployment without an oracle key never pays for
  // ethers on the server, and so unrelated routes cannot break at load time.
  const { JsonRpcProvider, Wallet, Contract } = await import("ethers");
  const provider = new JsonRpcProvider(config.rpcUrl!, config.chainId);
  const wallet = new Wallet(readEnv(ORACLE_PRIVATE_KEY_VAR)!, provider);
  const contract = new Contract(
    config.contractAddress!,
    ["function reportRainfall(uint256 policyId, uint256 totalMm)"],
    wallet,
  );
  // ethers exposes ABI methods through an index signature, so the call is
  // pulled out and typed explicitly rather than relied on structurally.
  const report = contract["reportRainfall"] as (
    policyId: number,
    totalMm: number,
  ) => Promise<{ hash: string; wait(): Promise<{ hash: string } | null> }>;

  const transport: OracleTransport = {
    reportRainfall: (policyId, totalMm) => report(policyId, totalMm),
  };
  return { transport, oracle: wallet.address };
}

export interface SubmitOracleReportOptions {
  /** Injected in tests so the settlement path is exercised without a node. */
  transport?: OracleTransport;
  /** Injected in tests; defaults to the real configuration. */
  config?: OracleReportConfig;
}

/**
 * Verify a reading and, only if it passes, submit it as the authorised oracle.
 *
 * The contract's `onlyOracle` modifier is the authentication boundary: a report
 * signed by any other account reverts. This function therefore never attempts a
 * submission it cannot sign for.
 */
export async function submitOracleReport(
  input: { policyId: number; snapshot: WeatherSnapshot; expected: ClaimWindow },
  options: SubmitOracleReportOptions = {},
): Promise<OracleReportOutcome> {
  const authorisation = authoriseClaimReport(input.snapshot, input.expected);
  const config = options.config ?? getOracleReportConfig();

  if (!authorisation.authorised || authorisation.totalMm === null) {
    return {
      submitted: false,
      txHash: null,
      explorerUrl: null,
      reason: `Report refused: ${authorisation.blockedBy.map(describeClaimBlock).join(" ")}`,
      authorisation,
      oracle: config.oracleAddress,
    };
  }

  if (!options.transport && !config.enabled) {
    return {
      submitted: false,
      txHash: null,
      explorerUrl: null,
      reason: `On-chain reporting is not configured: ${config.missing.join(", ")}.`,
      authorisation,
      oracle: null,
    };
  }

  try {
    const signed = options.transport
      ? { transport: options.transport, oracle: config.oracleAddress ?? "injected" }
      : await buildEthersTransport(config);

    const tx = await signed.transport.reportRainfall(input.policyId, authorisation.totalMm);
    const receipt = await tx.wait();
    if (!receipt) {
      return {
        submitted: false,
        txHash: null,
        explorerUrl: null,
        reason: "The report transaction was sent but not mined.",
        authorisation,
        oracle: signed.oracle,
      };
    }

    return {
      submitted: true,
      txHash: receipt.hash,
      explorerUrl: explorerTxUrl(receipt.hash),
      reason: null,
      authorisation,
      oracle: signed.oracle,
    };
  } catch (error) {
    // A revert here is expected and correct when the contract disagrees with the
    // local view (wrong window, already reported, paused, not the oracle).
    const message = error instanceof Error ? error.message : "Unknown contract error.";
    return {
      submitted: false,
      txHash: null,
      explorerUrl: null,
      reason: `The contract rejected the report: ${message}`,
      authorisation,
      oracle: options.config?.oracleAddress ?? null,
    };
  }
}
