/**
 * Chain + contract configuration.
 *
 * SkyCover targets the Sepolia testnet (chain ID 11155111). Contracts are NOT
 * deployed yet, so the UI runs in clearly-labelled demo mode. When contracts
 * are deployed, paste their addresses here and every on-chain feature
 * (buying, claiming, pool deposits/withdrawals, live tx hashes) lights up.
 */
export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";
export const SEPOLIA_CHAIN_NAME = "Sepolia";
export const EXPLORER_BASE = "https://sepolia.etherscan.io";

export interface ContractConfig {
  /** SkyCoverInsurance proxy address, or null while pending deployment. */
  insurance: string | null;
  /** SkyCoverPool address, or null while pending deployment. */
  pool: string | null;
}

export const CONTRACTS: ContractConfig = {
  insurance: null,
  pool: null,
};

export function isOnchainEnabled(): boolean {
  return CONTRACTS.insurance !== null;
}

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${txHash}`;
}
