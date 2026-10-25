import { createFileRoute, Link } from "@tanstack/react-router";
import { CloudRain, FileText, IndianRupee, MapPin, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";

import { OnchainPendingNotice, PageHeader, PolicyStatusBadge, SimulatedBadge } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@/components/wallet-provider";
import { useDemoState } from "@/hooks/use-demo-state";
import { SEPOLIA_CHAIN_NAME } from "@/lib/chain";
import { claimPayoutOnchain } from "@/lib/contract";
import { claimPayout, type DemoPolicy } from "@/lib/demo";
import { formatInr } from "@/lib/upi/types";
import { shortenAddress } from "@/lib/wallet";

export const Route = createFileRoute("/policies")({
  head: () => ({
    meta: [
      { title: "My Policies — SkyCover" },
      {
        name: "description",
        content: "View your SkyCover policies: coverage, premium, rainfall threshold, dates and payout status.",
      },
      { property: "og:title", content: "My Policies — SkyCover" },
      {
        property: "og:description",
        content: "Track every policy's rainfall reading, eligibility and payout status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PoliciesPage,
});

function PoliciesPage() {
  const demo = useDemoState();
  const wallet = useWallet();

  async function claim(policy: DemoPolicy) {
    if (policy.onchainPolicyId !== undefined) {
      try {
        const result = await claimPayoutOnchain(policy.onchainPolicyId);
        claimPayout(policy.id, result.txHash);
        toast.success(`Payout claimed on-chain for ${policy.id}`, {
          description: `Transaction ${result.txHash.slice(0, 10)}… confirmed on Sepolia.`,
          action: { label: "View", onClick: () => window.open(result.explorerUrl, "_blank") },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Claim transaction failed");
      }
      return;
    }

    const result = claimPayout(policy.id);
    if (result.ok) {
      toast.success(`Payout claim recorded for ${policy.id}`, {
        description:
          "Demo ledger only — the claim is recorded against the simulated pool. No bank transfer has been made and no real money has been paid.",
      });
    } else {
      toast.error(`Claim rejected: ${result.reason}`);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-20">
      <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">My Policies</h1>
          <p className="mt-2 text-[1.0625rem] leading-relaxed text-muted-foreground">Monitor your active coverage and trigger automated payouts.</p>
        </div>
        <Button asChild className="h-11 px-6 font-semibold">
          <Link to="/buy">New Policy</Link>
        </Button>
      </div>

      <div className="mt-12 grid gap-6">
        <Card className="border-border bg-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-lavender/15 text-lavender-strong">
                <Wallet className="size-5" />
              </div>
              <div>
                <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">Connected Wallet</div>
                <div className="font-mono text-sm">{wallet.address ? shortenAddress(wallet.address) : "Not Connected"}</div>
              </div>
            </div>
            {wallet.address && (
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">Balance</div>
                  <div className="font-display text-lg font-semibold text-terracotta-strong">{wallet.balanceEth ?? "0.00"} ETH</div>
                </div>
                <Badge variant="outline" className="border-sage/40 bg-sage/12 text-sage-strong">
                  {SEPOLIA_CHAIN_NAME} Testnet
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        {demo.policies.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[2rem] border border-dashed border-border py-24 text-center">
            <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-secondary">
              <FileText className="size-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold">No policies found</h3>
            <p className="mt-2 max-w-sm text-muted-foreground">
              You haven't purchased any rain insurance yet. Start by configuring your first policy.
            </p>
            <Button asChild className="mt-8" variant="outline">
              <Link to="/buy">Get Protected Now</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {demo.policies.map((p) => (
              <Card key={p.id} className="group flex flex-col border-border bg-card transition-[box-shadow,border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-terracotta/35 hover:shadow-lift">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
                  <div>
                    <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">Policy ID</div>
                    <CardTitle className="font-display text-xl font-semibold">{p.id}</CardTitle>
                  </div>
                  <PolicyStatusBadge status={p.status} />
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-6 pt-0">
                  <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2">
                    <MapPin className="size-4 text-plum" />
                    <span className="text-sm font-semibold">{p.locationName}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">Coverage</div>
                      <div className="font-display text-lg font-semibold">{p.coverageEth} ETH</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">Premium</div>
                      <div className="font-display text-lg font-semibold">{p.premiumEth} ETH</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">Threshold</div>
                      <div className="font-display text-lg font-semibold text-rain-strong">{p.thresholdMm} mm</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">Period</div>
                      <div className="text-xs font-medium">{p.startDate} <br /> {p.endDate}</div>
                    </div>
                  </div>

                  {p.upiPayment && (
                    <div className="space-y-2 rounded-xl border border-forest/25 bg-forest-tint/60 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.1em] text-forest">
                          <IndianRupee className="size-3.5" /> UPI Premium
                        </div>
                        {p.upiPayment.simulated ? (
                          <SimulatedBadge>Demo payment</SimulatedBadge>
                        ) : (
                          <Badge variant="outline" className="border-sage/60 bg-sage/15 text-sage-strong">
                            <ShieldCheck /> Verified
                          </Badge>
                        )}
                      </div>
                      <div className="font-display text-2xl font-semibold text-forest">
                        {formatInr(p.upiPayment.amountInr)}
                      </div>
                      <div className="space-y-0.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
                        <div>Order {p.upiPayment.orderId}</div>
                        <div>
                          {p.upiPayment.simulated
                            ? "Simulated settlement — no real money moved."
                            : `Verified server-side (${p.upiPayment.verification})${p.upiPayment.paymentRef ? ` · ${p.upiPayment.paymentRef}` : ""
                            }`}
                        </div>
                        <div>Paid {new Date(p.upiPayment.paidAt).toLocaleDateString()}</div>
                      </div>
                    </div>
                  )}

                  {p.rainfall ? (
                    <div className="mt-auto space-y-3 rounded-xl border border-rain/30 bg-rain/8 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.1em] text-rain-strong">
                          <CloudRain className="size-4" /> Observed Rainfall
                        </div>
                        {p.rainfall.scenario !== "real" && <SimulatedBadge />}
                      </div>
                      <div className="flex items-end gap-2">
                        <span className="font-display text-3xl font-semibold">{p.rainfall.totalMm}</span>
                        <span className="mb-1 text-sm font-medium text-muted-foreground">mm</span>
                      </div>
                      <div className="text-xs leading-tight text-muted-foreground italic">
                        Verified by Open-Meteo Oracle · {new Date(p.rainfall.evaluatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-auto flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center">
                      <div className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">Monitoring</div>
                      <p className="text-xs text-muted-foreground">Waiting for period to end for final rainfall verification.</p>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    {p.status === "eligible" && (
                      <Button size="lg" className="w-full font-semibold" onClick={() => claim(p)}>
                        {p.onchainPolicyId !== undefined ? "Collect Payout" : "Record Payout Claim"}
                      </Button>
                    )}
                    {p.status === "eligible" && p.upiPayment && (
                      <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                        Paying an eligible UPI policy out to a bank account needs an authorised payout provider. None is
                        configured here, so this records the claim only and no transfer is made.
                      </p>
                    )}
                    {p.status === "active" && (
                      <Button variant="secondary" size="lg" className="w-full font-semibold" asChild>
                        <Link to="/oracle">Evaluate Now</Link>
                      </Button>
                    )}
                    <div className="flex justify-center">
                      {p.upiPayment && !p.upiPayment.simulated ? (
                        <Badge variant="outline" className="border-sage/60 bg-sage/15 text-sage-strong">
                          <ShieldCheck /> Premium paid via UPI
                        </Badge>
                      ) : p.upiPayment ? (
                        <SimulatedBadge>Premium: simulated UPI</SimulatedBadge>
                      ) : p.onchainPolicyId !== undefined ? (
                        <Badge variant="outline" className="border-lavender/60 bg-lavender/15 text-lavender-strong">
                          <ShieldCheck /> Paid on {SEPOLIA_CHAIN_NAME} (testnet)
                        </Badge>
                      ) : (
                        <SimulatedBadge>Purchase Simulated</SimulatedBadge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-xs">{value}</div>
    </div>
  );
}
