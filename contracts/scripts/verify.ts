import { ethers, run } from "hardhat";

/**
 * Verify a deployed SkyCoverInsurance on Etherscan.
 *
 *   SKYCOVER_INSURANCE_ADDRESS=0x... npm run verify:sepolia
 *
 * The single constructor argument is ORACLE_ADDRESS.
 */
async function main() {
  const address = process.env.SKYCOVER_INSURANCE_ADDRESS ?? "";
  const oracle = process.env.ORACLE_ADDRESS ?? "";

  if (!ethers.isAddress(address)) {
    throw new Error("Set SKYCOVER_INSURANCE_ADDRESS to the deployed contract address.");
  }
  if (!ethers.isAddress(oracle)) {
    throw new Error("Set ORACLE_ADDRESS to the constructor oracle address used at deployment.");
  }
  if (!process.env.ETHERSCAN_API_KEY) {
    throw new Error("Set ETHERSCAN_API_KEY to verify on Etherscan.");
  }

  console.log(`Verifying ${address} with constructor arg ${oracle}`);
  await run("verify:verify", {
    address,
    constructorArguments: [oracle],
  });
  console.log("Verification submitted.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
