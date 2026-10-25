import { BrowserProvider, formatEther } from "ethers";
import { SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID_HEX, SEPOLIA_CHAIN_NAME } from "./chain";

/**
 * MetaMask helpers. Every function touches window.ethereum only when invoked
 * from a user event handler, so SSR never sees browser globals. No private
 * keys are ever handled here — MetaMask signs everything.
 */

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function getEthereum(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  const eth = (window as any).ethereum;
  if (!eth) return null;
  
  // Some wallets might inject multiple providers, detect the one that is MetaMask
  if (eth.providers && Array.isArray(eth.providers)) {
    return eth.providers.find((p: any) => p.isMetaMask) || eth.providers[0] || null;
  }
  
  return eth;
}

export function hasMetaMask(): boolean {
  const eth = getEthereum();
  return !!eth && (eth as any).isMetaMask;
}

export async function connectWallet(): Promise<{ address: string; chainId: number }> {
  const eth = getEthereum();
  if (!eth) {
    throw new Error("No Ethereum provider detected. Please install MetaMask.");
  }

  try {
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    const [first] = accounts ?? [];
    if (!first) throw new Error("No accounts found. Please unlock your wallet.");

    const chainId = await getChainId();
    return { address: first, chainId };
  } catch (err: any) {
    if (err.code === 4001) {
      throw new Error("Connection request was rejected by the user.");
    }
    if (err.code === -32002) {
      throw new Error("Connection request is already pending in MetaMask. Please open the extension.");
    }
    throw err;
  }
}

export async function getChainId(): Promise<number> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not detected.");
  const hex = (await eth.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(hex, 16);
}

/** Ask the wallet to switch to Sepolia, adding it first if unknown. */
export async function switchToSepolia(): Promise<void> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not detected.");
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4902 || code === -32603) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: SEPOLIA_CHAIN_ID_HEX,
            chainName: SEPOLIA_CHAIN_NAME,
            nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://rpc.sepolia.org"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
      return;
    }
    throw err;
  }
}

/** Actual on-chain balance of an address, read through the wallet provider. */
export async function getWalletBalance(address: string): Promise<string> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not detected.");
  const provider = new BrowserProvider(eth);
  const balance = await provider.getBalance(address);
  return formatEther(balance);
}

export function isSepolia(chainId: number): boolean {
  return chainId === SEPOLIA_CHAIN_ID;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
