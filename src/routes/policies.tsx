import { createFileRoute, Link } from "@tanstack/react-router";
import { CloudRain, FileText, Wallet } from "lucide-react";
import { toast } from "sonner";

import { OnchainPendingNotice, PageHeader, PolicyStatusBadge, SimulatedBadge } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@/components/wallet-provider";
import { useDemoState } from "@/hooks/use-demo-state";
import { claimPayout } from "@/lib/demo";

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

  function claim(policyId: string) {
    const result = claimPayout(policyId);
    if (result.ok) {
      toast.success(`Payout triggered for ${policyId}`, {
        description: "Simulated payout — funds moved within the demo pool. See Transparency for the event.",
      });
    } else {
      toast.error(`Claim rejected: ${result.reason}`);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader
        title="My Policies"
        description="Every policy shows its ID, location, premium, coverage, rainfall threshold, dates and current status."
        right={
          <Button asChild size="sm" variant="secondary">
            <Link to="/buy">New policy</Link>
          </Button>
        }
      />

      <div className="mb-6 space-y-3">
        <OnchainPendingNotice>
          Policies you purchase today are demo records stored in this browser. Once the insurance
          contract is deployed, policies bought on-chain will appear here with their real policy ID,
          owner and transaction hash.
        </OnchainPendingNotice>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
            <Wallet className="size-4 text-primary" />
            {wallet.address ? (
              <>
                <span>
                  Connected wallet: <span className="font-mono text-xs">{wallet.address}</span>
                </span>
                <Badge variant="outline" className="border-success/40 text-success">
                  Balance {wallet.balanceEth ?? "…"} ETH
                </Badge>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">No wallet connected.</span>
                <Button size="sm" variant="outline" onClick={() => wallet.connect()}>
                  Connect MetaMask
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {demo.policies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <FileText className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No policies yet. Buy one in demo mode to walk through rainfall evaluation and payouts.
            </p>
            <Button asChild>
              <Link to="/buy">Get Covered</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {demo.policies.map((p) => (
            <Card key={p.id} className="card-glow">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="font-display text-lg">
                  {p.id} · {p.locationName}
                </CardTitle>
                <PolicyStatusBadge status={p.status} />
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <Field label="Premium" value={`${p.premiumEth} ETH`} />
                  <Field label="Coverage" value={`${p.coverageEth} ETH`} />
                  <Field label="Rainfall threshold" value={`${p.thresholdMm} mm`} />
                  <Field label="Window" value={`${p.startDate} → ${p.endDate}`} />
                </div>

                {p.rainfall && (
                  <div className="rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-xs">
                    <div className="flex items-center gap-1.5 font-medium">
                      <CloudRain className="size-3.5 text-accent" />
                      Rainfall over window: <span className="font-mono">{p.rainfall.totalMm} mm</span>
                      {p.rainfall.scenario !== "real" && <SimulatedBadge />}
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      Source: {p.rainfall.source} · evaluated{" "}
                      {new Date(p.rainfall.evaluatedAt).toLocaleString()}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {p.status === "eligible" && (
                    <Button size="sm" onClick={() => claim(p.id)}>
                      Trigger payout
                    </Button>
                  )}
                  <SimulatedBadge>Purchase simulated</SimulatedBadge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
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
