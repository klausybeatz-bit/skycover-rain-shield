import { ethers } from "hardhat";

import * as dotenv from "dotenv";
import path from "node:path";

// Load contracts/.env explicitly so the check behaves the same regardless of the
// working directory it is invoked from.
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const PUBLIC_RPC_FALLBACK = "https://ethereum-sepolia-rpc.publicnode.com";

/**
 * The host of an RPC URL only. A full RPC URL often embeds an API token (e.g.
 * `/v3/<project-id>`), so it must never be echoed to the console.
 */
function rpcHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Pre-flight check for a Sepolia deployment. It validates the environment
 * without touching the network, so it is safe to run at any time:
 *
 *   npm run check:env
 *
 * Never prints private keys, API keys or full RPC URLs. Exits non-zero when a
 * setting required for deployment is missing or invalid.
 */
function main(): void {
  const oracle = (process.env.ORACLE_ADDRESS ?? "").trim();
  const rpc = (process.env.SEPOLIA_RPC_URL ?? "").trim();
  const key = (process.env.DEPLOYER_PRIVATE_KEY ?? "").trim();
  const seedRaw = process.env.INITIAL_POOL_ETH;
  const etherscanKey = (process.env.ETHERSCAN_API_KEY ?? "").trim();

  const problems: string[] = [];

  // --- Oracle address -------------------------------------------------------
  let oracleStatus: string;
  if (!oracle) {
    oracleStatus = "MISSING — required to deploy";
    problems.push("ORACLE_ADDRESS is not set.");
  } else if (!ethers.isAddress(oracle)) {
    oracleStatus = "INVALID — not an Ethereum address";
    problems.push("ORACLE_ADDRESS is not a valid Ethereum address.");
  } else {
    oracleStatus = `${oracle} (valid)`;
  }

  // --- Deployer private key -------------------------------------------------
  let keyStatus: string;
  let deployerAddress: string | null = null;
  if (!key) {
    keyStatus = "MISSING — required to deploy";
    problems.push("DEPLOYER_PRIVATE_KEY is not set.");
  } else if (PRIVATE_KEY_PATTERN.test(key)) {
    keyStatus = "VALID";
    deployerAddress = ethers.computeAddress(key);
  } else {
    keyStatus = "INVALID — expected 0x + 64 hex characters";
    problems.push(
      "DEPLOYER_PRIVATE_KEY is not a valid 32-byte private key (expected 0x followed by 64 hex characters).",
    );
  }

  // --- Seed liquidity -------------------------------------------------------
  const seed = seedRaw ?? "0";
  let seedWei = 0n;
  let seedStatus: string;
  try {
    seedWei = ethers.parseEther(seed);
    if (seedWei < 0n) {
      seedStatus = "INVALID — negative";
      problems.push(`INITIAL_POOL_ETH cannot be negative: ${seed}`);
    } else {
      seedStatus = `${seed} ETH${seedRaw === undefined ? " (default — INITIAL_POOL_ETH not set)" : ""}`;
    }
  } catch {
    seedStatus = "INVALID — not an ETH amount";
    problems.push(`INITIAL_POOL_ETH is not a valid ETH amount: ${seed}`);
  }

  // --- RPC ------------------------------------------------------------------
  let rpcStatus: string;
  if (!rpc) {
    rpcStatus = `not set — public fallback will be used (host: ${rpcHost(PUBLIC_RPC_FALLBACK)})`;
  } else {
    const host = rpcHost(rpc);
    if (host) {
      rpcStatus = `set (host: ${host})`;
    } else {
      rpcStatus = "INVALID — not a valid URL";
      problems.push("SEPOLIA_RPC_URL is set but is not a valid URL.");
    }
  }

  console.log("SkyCover deployment environment");
  console.log("-------------------------------");
  console.log(`DEPLOYER_PRIVATE_KEY : ${keyStatus}`);
  console.log(`Deployer address     : ${deployerAddress ?? "(unknown until a valid key is provided)"}`);
  console.log(`ORACLE_ADDRESS       : ${oracleStatus}`);
  console.log(`SEPOLIA_RPC_URL      : ${rpcStatus}`);
  console.log(`INITIAL_POOL_ETH     : ${seedStatus}`);
  console.log(`ETHERSCAN_API_KEY    : ${etherscanKey ? "set (verification enabled)" : "not set (verification disabled)"}`);

  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s) — deployment is not ready:`);
    for (const p of problems) console.log(` - ${p}`);
    console.log("\nNot OK — fix the problems above before `npm run deploy:sepolia`.");
    process.exitCode = 1;
    return;
  }

  console.log("\nOK — environment looks ready for `npm run deploy:sepolia`.");
}

main();
