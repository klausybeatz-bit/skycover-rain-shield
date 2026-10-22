import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { isSepolia } from "@/lib/wallet";
import {
  connectWallet,
  getChainId,
  getWalletBalance,
  hasMetaMask,
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

interface Eip1193WithEvents {
  on(event: string, cb: (...args: unknown[]) => void): void;
  removeListener(event: string, cb: (...args: unknown[]) => void): void;
}

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
      if (!isSepolia(cid)) {
        try {
          await switchToSepolia();
          setChainId(await getChainId());
        } catch {
          /* user rejected the switch — stay connected on the current chain */
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
      setChainId(await getChainId());
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
    const eth = (window as unknown as { ethereum?: Eip1193WithEvents }).ethereum;
    if (!eth?.on) return;
    const onAccounts = (accounts: unknown[]) => {
      if (!Array.isArray(accounts) || accounts.length === 0) {
        disconnect();
      } else {
        setAddress(String(accounts[0]));
      }
    };
    const onChain = (cid: unknown) => setChainId(Number.parseInt(String(cid), 16));
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener("accountsChanged", onAccounts);
      eth.removeListener("chainChanged", onChain);
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

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

export { shortenAddress };
