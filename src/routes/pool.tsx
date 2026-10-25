import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowUpFromLine, Droplet, Landmark, PiggyBank, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { OnchainPendingNotice, PageHeader, SimulatedBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/components/wallet-provider";
import { useDemoState } from "@/hooks/use-demo-state";
import { isOnchainEnabled } from "@/lib/chain";
import { depositPoolOnchain, readPoolStats, withdrawPoolOnchain } from "@/lib/contract";
import { recordPoolActivity } from "@/lib/demo";

export const Route = createFileRoute("/pool")({
  head: () => ({
    meta: [
      { title: "Liquidity Pool — SkyCover" },
      {
        name: "description",
        content:
          "SkyCover's liquidity pool backs every policy: premiums collected, payouts made, available liquidity and utilization.",
      },
      { property: "og:title", content: "Liquidity Pool — SkyCover" },
      {
        property: "og:description",
        content: "Premiums in, payouts out — verify the pool can always cover active policies.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PoolPage,
});

function PoolPage() {
  const demo = useDemoState();
  const wallet = useWallet();
  const [amount, setAmount] = useState("0.5");
  const [busy, setBusy] = useState(false);
  const [onchainPool, setOnchainPool] = useState<typeof demo.pool | null>(null);
  const value = Number(amount) || 0;

  async function refreshOnchainPool() {
    try {
      const stats = await readPoolStats();
      setOnchainPool({
        balanceEth: stats.balanceEth,
        premiumsCollectedEth: stats.premiumsEth,
        payoutsEth: stats.payoutsEth,
      });
    } catch {
      /* keep the demo figures until the wallet/contract responds */
    }
  }

  useEffect(() => {
    if (!isOnchainEnabled()) return;
    void refreshOnchainPool();
  }, []);

  const pool = onchainPool ?? demo.pool;

  const utilization =
    pool.payoutsEth + pool.balanceEth > 0
      ? (pool.payoutsEth / (pool.payoutsEth + pool.balanceEth)) * 100
      : 0;

  async function deposit() {
    if (value <= 0) {
      toast.error("Enter an amount above 0");
      return;
    }
    if (isOnchainEnabled() && wallet.address) {
      setBusy(true);
      try {
        const result = await depositPoolOnchain(value);
        recordPoolActivity("pool_deposit", value, result.txHash);
        await refreshOnchainPool();
        toast.success(`Deposited ${value} ETH on-chain`, {
          description: `Transaction ${result.txHash.slice(0, 10)}… confirmed on Sepolia.`,
          action: { label: "View", onClick: () => window.open(result.explorerUrl, "_blank") },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Deposit transaction failed");
      } finally {
        setBusy(false);
      }
      return;
    }
    recordPoolActivity("pool_deposit", value);
    toast.success(`Deposited ${value} ETH into the demo pool`);
  }

  async function withdraw() {
    if (value <= 0) {
      toast.error("Enter an amount above 0");
      return;
    }
    if (value > pool.balanceEth) {
      toast.error("Amount exceeds available liquidity");
      return;
    }
    if (isOnchainEnabled() && wallet.address) {
      setBusy(true);
      try {
        const result = await withdrawPoolOnchain(value);
        recordPoolActivity("pool_withdraw", value, result.txHash);
        await refreshOnchainPool();
        toast.success(`Withdrew ${value} ETH on-chain`, {
          description: `Transaction ${result.txHash.slice(0, 10)}… confirmed on Sepolia.`,
          action: { label: "View", onClick: () => window.open(result.explorerUrl, "_blank") },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Withdraw transaction failed");
      } finally {
        setBusy(false);
      }
      return;
    }
    recordPoolActivity("pool_withdraw", value);
    toast.success(`Withdrew ${value} ETH from the demo pool`);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader
        title="Liquidity Pool"
        description="Premiums flow into the pool; payouts flow out. Every policyholder is backed by this reserve."
      />
      <div className="mb-6">
        <OnchainPendingNotice>
          The pool contract is not deployed yet. Figures below are demo values and simulated
          movements only — deposit/withdraw on-chain will activate once the pool contract address is
          configured.
        </OnchainPendingNotice>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Landmark} label="Pool balance" value={`${pool.balanceEth.toFixed(2)} ETH`} highlight />
        <Stat icon={PiggyBank} label="Premiums collected" value={`${pool.premiumsCollectedEth.toFixed(2)} ETH`} />
        <Stat icon={Droplet} label="Payouts made" value={`${pool.payoutsEth.toFixed(2)} ETH`} />
        <Stat icon={Wallet} label="Utilization" value={`${utilization.toFixed(1)}%`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ArrowDownToLine className="size-5 text-terracotta" /> Provider actions
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount (ETH)</Label>
              <Input
                id="amount"
                type="number"
                min={0.01}
                step={0.1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={deposit}
                disabled={!wallet.address || busy}
                title={!wallet.address ? "Connect wallet first" : undefined}
              >
                {busy ? "Confirm in MetaMask…" : "Deposit"}
              </Button>
              <Button
                className="flex-1"
                variant="secondary"
                onClick={withdraw}
                disabled={!wallet.address || busy}
                title={!wallet.address ? "Connect wallet first" : undefined}
              >
                Withdraw
              </Button>
            </div>
            {isOnchainEnabled() ? (
              <p className="text-xs text-muted-foreground">
                Deposits and withdrawals are signed with MetaMask and move real Sepolia testnet ETH
                through the pool contract.
              </p>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <SimulatedBadge /> Deposits and withdrawals move simulated ETH inside the demo pool.
                They earn no yield and involve no funds.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">How the pool stays solvent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Each premium raises the pool balance the moment a policy is issued, so every active
              policy is backed from day one. The contract sizes payouts against available liquidity
              before releasing funds.
            </p>
            <p>
              Providers earn a share of premiums for supplying capital, and can withdraw excess
              liquidity that is not reserved for active policies.
            </p>
            <p>
              In the deployed contract, all of this is enforced on-chain:{" "}
              <code className="font-mono text-xs">deposit()</code>,{" "}
              <code className="font-mono text-xs">withdraw()</code> and{" "}
              <code className="font-mono text-xs">claimPayout()</code> check balances before any
              transfer. See <span className="font-mono text-xs">contracts/SkyCoverInsurance.sol</span>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "card-glow border-terracotta/40" : undefined}>
      <CardContent className="pt-6">
        <Icon className="size-5 text-terracotta" />
        <div className="mt-3 text-xs text-muted-foreground">{label}</div>
        <div className="font-display text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
