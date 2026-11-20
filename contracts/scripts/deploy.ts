import { ethers } from "hardhat";

import * as dotenv from "dotenv";
import path from "node:path";

// Load contracts/.env explicitly so the script behaves the same regardless of
// the working directory it is invoked from.
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const SEPOLIA_CHAIN_ID = 11155111n;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * Deploy SkyCoverInsurance to Sepolia.
 *
 *   npm run deploy:sepolia
 *
 * Configuration is validated fully before any network write, and the deployment
 * is refused unless the RPC reports chainId 11155111. Prints the deployer
 * address, oracle address and seed amount — never the private key, API keys or
 * the full RPC URL.
 *
 * This performs a real deployment. Do not run it without explicit approval to
 * spend Sepolia ETH.
 */
async function main() {
  // --- 1. Configuration (fail fast, before touching the network) ------------
  const oracle = (process.env.ORACLE_ADDRESS ?? "").trim();
  if (!ethers.isAddress(oracle)) {
    throw new Error("ORACLE_ADDRESS must be set to a valid Ethereum address before deploying.");
  }

  const key = (process.env.DEPLOYER_PRIVATE_KEY ?? "").trim();
  if (!PRIVATE_KEY_PATTERN.test(key)) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY must be a valid 32-byte private key (0x followed by 64 hex characters).",
    );
  }

  const seedRaw = process.env.INITIAL_POOL_ETH;
  const seedEth = seedRaw ?? "0";
  let seedWei: bigint;
  try {
    seedWei = ethers.parseEther(seedEth);
  } catch {
    throw new Error(`INITIAL_POOL_ETH is not a valid ETH amount: ${seedEth}`);
  }
  if (seedWei < 0n) {
    throw new Error(`INITIAL_POOL_ETH cannot be negative: ${seedEth}`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer is available — check DEPLOYER_PRIVATE_KEY.");
  }

  // --- 2. Network (refuse anything that is not Sepolia) ---------------------
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Refusing to deploy: expected chainId ${SEPOLIA_CHAIN_ID} (Sepolia) but the RPC reports ${network.chainId}.`,
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("SkyCover deployment");
  console.log("-------------------");
  console.log(`Network  : Sepolia (chainId ${network.chainId})`);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log(`Oracle   : ${oracle}`);
  console.log(
    `Seed     : ${seedEth} ETH${seedRaw === undefined ? " (INITIAL_POOL_ETH not set — defaulting to 0)" : ""}`,
  );

  if (balance < seedWei) {
    throw new Error(
      `Deployer balance ${ethers.formatEther(balance)} ETH is below the requested seed of ${seedEth} ETH.`,
    );
  }

  // --- 3. Deploy ------------------------------------------------------------
  const factory = await ethers.getContractFactory("SkyCoverInsurance");
  const insurance = await factory.deploy(oracle, { value: seedWei });
  await insurance.waitForDeployment();

  const address = await insurance.getAddress();
  const deploymentTx = insurance.deploymentTransaction();

  console.log("\nSkyCoverInsurance deployed");
  console.log(`  address   : ${address}`);
  console.log(`  tx        : ${deploymentTx?.hash ?? "(unknown)"}`);
  console.log(`  etherscan : https://sepolia.etherscan.io/address/${address}`);

  console.log("\nNext: set VITE_SKYCOVER_INSURANCE_ADDRESS to the address above.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
