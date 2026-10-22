import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { isSepolia, SEPOLIA_CHAIN_NAME } from "@/lib/chain";
import {
  connectWallet,
  getWalletBalance,
  hasMetaMask,
  isSepolia as checkSepolia,
  shortenAddress,
  switchToSepolia,
} from "@/lib/wallet";

interface WalletState {
  address: string | null;
  chainId: number | null;
  balanceEth: string | null;
  connecting: boolean;
  error: string | null;
  hasMetaMask: boolean;
  onSepolia: boolean;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balanceEth, setBalanceEth] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    try {
      setBalanceEth(await getWalletBalance(address));
    } catch {
      setBalanceEth(null);
    }
  }, [address]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { address: addr, chainId: cid } = await connectWallet();
      setAddress(addr);
      setChainId(cid);
      if (cid !== isSepolia(cid) ? undefined : undefined) {
        // no-op guard removed below
      }
      if (cid !== undefined && !checkSepolia(cid)) {
        try {
          await switchToSepolia();
          setChainId(await getChainIdSafe());
        } catch {
          /* user rejected the switch — keep them connected on the wrong chain */
        }
      }
      try {
        setBalanceEth(await getWalletBalance(addr));
      } catch {
        setBalanceEth(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    setError(null);
    try {
      await switchToSepolia();
      setChainId(await getChainIdSafe());
      await refreshBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch network");
    }
  }, [refreshBalance]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setBalanceEth(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const eth = (window as unknown as { ethereum?: { on?: (e: string, cb: (...args: unknown[]) => void) => void } }).ethereum;
    if (!eth?.on) return;
    const onAccounts = (accounts: unknown[]) => {
      if (!Array.isArray(accounts) || accounts.length === 0) {
        disconnect();
      } else {
        setAddress(accounts[0] as string);
      }
    };
    const onChain = (cid: unknown) => setChainId(Number.parseInt(String(cid), 16));
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.on("accountsChanged", onAccounts);
      eth.on("chainChanged", onChain);
    };
  }, [disconnect]);

  const value: WalletState = {
    address,
    chainId,
    balanceEth,
    connecting,
    error,
    hasMetaMask: hasMetaMask(),
    onSepolia: chainId !== null && isSepolia(chainId),
    connect,
    switchNetwork,
    refreshBalance,
    disconnect,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

async function getChainIdSafe(): Promise<number> {
  const { getChainId } = await import("@/lib/wallet");
  return getChainId();
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

export { shortenAddress, SEPOLIA_CHAIN_NAME };
