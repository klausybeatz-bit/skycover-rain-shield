import { Link, useRouterState } from "@tanstack/react-router";
import { CloudRain, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useScrolled } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isOnchainEnabled, EXPLORER_BASE, SEPOLIA_CHAIN_NAME } from "@/lib/chain";
import { useWallet } from "@/components/wallet-provider";
import { shortenAddress } from "@/lib/wallet";
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

type FooterLink =
  | { label: string; to: (typeof NAV_ITEMS)[number]["to"] }
  | { label: string; href: string };

const FOOTER_COLUMNS: ReadonlyArray<{ title: string; links: ReadonlyArray<FooterLink> }> = [
  {
    title: "Cover",
    links: [
      { label: "Buy Insurance", to: "/buy" },
      { label: "My Policies", to: "/policies" },
      { label: "Transparency Ledger", to: "/activity" },
    ],
  },
  {
    title: "Evidence",
    links: [
      { label: "Weather Oracle", to: "/oracle" },
      { label: "Liquidity Pool", to: "/pool" },
      { label: "Demo Mode", to: "/demo" },
    ],
  },
  {
    title: "Explore",
    links: [
      { label: "Overview", to: "/" },
      { label: "Sepolia Explorer", href: EXPLORER_BASE },
    ],
  },
];

function WalletButton() {
  const wallet = useWallet();

  // Surface connection failures — without this the button silently does nothing
  // when MetaMask is missing or the user rejects the request.
  useEffect(() => {
    if (wallet.error) toast.error(wallet.error);
  }, [wallet.error]);

  if (!wallet.address) {
    return (
      <Button
        onClick={() => wallet.connect()}
        disabled={wallet.connecting}
        size="sm"
        className="h-9 px-4"
        title={wallet.hasMetaMask ? undefined : "MetaMask not detected in this browser"}
      >
        {wallet.connecting ? "Connecting…" : "Connect Wallet"}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {wallet.onSepolia ? (
        <Badge
          variant="outline"
          className="hidden h-6 border-sage/60 bg-sage/15 text-sage-strong sm:inline-flex"
        >
          {SEPOLIA_CHAIN_NAME}
        </Badge>
      ) : (
        <button
          onClick={() => wallet.switchNetwork()}
          className="rounded-full border border-amber/50 bg-amber/12 px-2.5 py-1 text-[0.6875rem] font-medium text-amber-strong transition-colors duration-200 hover:bg-amber/25"
        >
          Switch to {SEPOLIA_CHAIN_NAME}
        </button>
      )}
      <div className="hidden flex-col items-end sm:flex">
        <div className="font-mono text-[0.625rem] leading-tight text-muted-foreground">
          {shortenAddress(wallet.address)}
        </div>
        <div className="text-[0.6875rem] font-medium leading-tight tabular-nums">
          {wallet.balanceEth ?? "0.00"} ETH
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={wallet.disconnect}
        aria-label="Disconnect wallet"
        className="size-9 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const scrolled = useScrolled(8);
  const onchain = isOnchainEnabled();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header
        className={cn(
          "sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-300 ease-out",
          scrolled
            ? "border-b border-border bg-background/85 shadow-soft backdrop-blur-md"
            : "border-b border-transparent bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="group flex items-center gap-2.5 transition-opacity duration-200 hover:opacity-90"
            onClick={() => setMenuOpen(false)}
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform duration-300 ease-out group-hover:-rotate-6">
              <CloudRain className="size-[1.125rem]" />
            </span>
            <span className="font-display text-[1.125rem] font-bold tracking-tight">
              Sky<span className="text-terracotta-strong">Cover</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-0.5 xl:flex">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "group relative rounded-full px-3 py-2 text-[0.8125rem] font-medium transition-colors duration-200",
                    active ? "text-terracotta-strong" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-x-3 bottom-1 h-px origin-left bg-terracotta transition-transform duration-300 ease-out group-hover:scale-x-100",
                      active ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {!onchain && (
              <Badge
                variant="outline"
                className="hidden h-6 border-amber/50 bg-amber/12 text-amber-strong md:inline-flex"
              >
                Demo Mode
              </Badge>
            )}
            <WalletButton />
            <button
              className="rounded-full p-2 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground xl:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        <div
          className={cn(
            "overflow-hidden border-border bg-background/95 backdrop-blur-md transition-[max-height,opacity] duration-300 ease-out xl:hidden",
            menuOpen ? "max-h-[32rem] border-t opacity-100" : "max-h-0 opacity-0",
          )}
        >
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-sm transition-colors duration-200",
                    active
                      ? "bg-accent font-medium text-terracotta-strong"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="flex-1 overflow-x-hidden">{children}</main>

      <footer className="forest-band mt-16 text-white/75">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:py-16">
          <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="max-w-sm">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-xl bg-white/12 text-white">
                  <CloudRain className="size-4" />
                </span>
                <span className="font-display text-base font-bold tracking-tight text-white">
                  Sky<span className="text-coral">Cover</span>
                </span>
              </div>
              <p className="mt-4 text-[0.8125rem] leading-relaxed">
                Parametric rainfall cover for the people whose income depends on the weather.
                Rainfall is verified from the Open-Meteo historical archive; settlement runs
                against a public Sepolia smart contract.
              </p>
            </div>

            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <h3 className="font-display text-[0.75rem] font-semibold tracking-[0.14em] text-white/90 uppercase">
                  {column.title}
                </h3>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {"href" in link ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[0.8125rem] transition-colors duration-200 hover:text-white"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          to={link.to}
                          className="text-[0.8125rem] transition-colors duration-200 hover:text-white"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col gap-4 border-t border-white/12 pt-7 text-[0.75rem] leading-relaxed sm:flex-row sm:items-start sm:justify-between">
            <p className="text-white/70">
              © 2026 SkyCover · Prototype on {SEPOLIA_CHAIN_NAME} · Weather data via Open-Meteo
            </p>
            <p className="max-w-md text-white/60 sm:text-right">
              Not real insurance and not a financial product. No real money is involved — only
              testnet ETH.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
