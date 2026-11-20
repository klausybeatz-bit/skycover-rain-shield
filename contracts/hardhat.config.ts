import type { HardhatUserConfig } from "hardhat/config";

import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-verify";

import * as dotenv from "dotenv";
import path from "node:path";

// Resolve contracts/.env relative to this file, so the environment is loaded
// the same way no matter which directory Hardhat is invoked from.
dotenv.config({ path: path.resolve(__dirname, ".env") });

const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

// Hardhat validates the network accounts while loading the config, so a blank
// or placeholder key would make *every* command fail (including compile/test).
// Only pass the key through when it is a real 32-byte hex key.
const hasDeployerKey = /^0x[0-9a-fA-F]{64}$/.test(DEPLOYER_PRIVATE_KEY);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  paths: {
    // Sources live in ./src (not ./contracts) so the Hardhat project can be
    // rooted in this folder without pulling node_modules into the compile glob.
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      // Empty accounts list when the key is missing or still a placeholder, so
      // `hardhat compile` and the local tests never require a real key.
      accounts: hasDeployerKey ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: { sepolia: ETHERSCAN_API_KEY },
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
