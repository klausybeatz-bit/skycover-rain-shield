import { Link, useRouterState } from "@tanstack/react-router";
import { CloudRain, Menu, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isOnchainEnabled, SEPOLIA_CHAIN_NAME } from "@/lib/chain";
import { useWallet } from "@/components/wallet-provider";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Home", to: "/" },
  { label: "Buy Insurance", to: "/buy" },
  { label: "My Policies", to: "/policies" },
  { label: "Weather Oracle", to: "/oracle" },
  { label: "Liquidity Pool", to: "/pool" },
  { label: "Transparency", to: "/activity" },
  { label: "Demo Mode", to: "/demo" },
] as const;

function WalletButton() {
  const wallet = useWallet();

  if (!wallet.address) {
    return (
      <Button onClick={() => wallet.connect()} disabled={wallet.connecting} size="sm">
        {wallet.connecting ? "Connecting…" : "Connect MetaMask"}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {wallet.onSepolia ? (
        <Badge variant="outline" className="border-success/40 text-success">
          {SEPOLIA_CHAIN_NAME}
        </Badge>
      ) : (
        <button
          onClick={() => wallet.switchNetwork()}
          className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
        >
          Wrong network — switch to {SEPOLIA_CHAIN_NAME}
        </button>
      )}
      <div className="hidden text-right sm:block">
        <div className="font-mono text-xs">{wallet.balanceEth ?? "…"} ETH</div>
        <div className="text-[11px] text-muted-foreground">{shortenAddress(wallet.address)}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={wallet.disconnect}>
        Exit
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onchain = isOnchainEnabled();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex items-center gap-2.5" onClick={() => setMenuOpen(false)}>
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <CloudRain className="size-5" />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">
              Sky<span className="text-gradient-sky">Cover</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  pathname === item.to
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {!onchain && (
              <Badge variant="outline" className="hidden border-warning/40 text-warning md:inline-flex">
                Demo mode
              </Badge>
            )}
            <WalletButton />
            <button
              className="rounded-md p-2 text-muted-foreground hover:text-foreground lg:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="flex flex-col gap-1 border-t border-border/60 px-4 py-3 lg:hidden">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "rounded-md px-3 py-2 text-sm",
                  pathname === item.to
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border/60 py-6">
        <div className="mx-auto max-w-6xl px-4 text-xs text-muted-foreground">
          SkyCover prototype · Sepolia testnet · Weather data from Open-Meteo · Not real insurance —
          no real money involved.
        </div>
      </footer>
    </div>
  );
}
