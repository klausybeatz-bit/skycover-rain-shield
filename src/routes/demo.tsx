import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, CloudRain, FilePlus2, PlayCircle, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { OnchainPendingNotice, PageHeader, PolicyStatusBadge, SimulatedBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDemoState } from "@/hooks/use-demo-state";
import { applyRainfallToPolicy, claimPayout, createDemoPolicy, type DemoPolicy } from "@/lib/demo";
import { isPayoutEligible } from "@/lib/premium";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Demo Mode — SkyCover" },
      {
        name: "description",
        content:
          "A judge-friendly walkthrough: create a policy, simulate rainfall, trigger an eligible testnet payout and see the result.",
      },
      { property: "og:title", content: "Demo Mode — SkyCover" },
      {
        property: "og:description",
        content: "Buy → simulate rainfall → automatic payout, in four guided steps.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DemoPage,
});

function DemoPage() {
  const demo = useDemoState();
  const [policyId, setPolicyId] = useState("");
  const [outcome, setOutcome] = useState<{ policy: DemoPolicy; paid: boolean } | null>(null);

  const active = demo.policies.filter((p) => p.status === "active");
  const selected = demo.policies.find((p) => p.id === policyId) ?? active[0] ?? null;

  function quickCreate() {
    const start = new Date();
    const end = new Date(start.getTime() + 29 * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const policy = createDemoPolicy({
      locationName: "Cherrapunji, Meghalaya",
      latitude: 25.28,
      longitude: 91.7,
      startDate: iso(start),
      endDate: iso(end),
      thresholdMm: 50,
      coverageEth: 0.1,
      premiumEth: 0.0075,
      holderAddress: null,
    });
    setPolicyId(policy.id);
    setOutcome(null);
    toast.success(`Demo policy ${policy.id} created`);
  }

  function simulate(kind: "low" | "normal") {
    if (!selected) return;
    const total = kind === "low" ? Math.round(selected.thresholdMm * 0.4 * 10) / 10 : Math.round(selected.thresholdMm * 1.6 * 10) / 10;
    const updated = applyRainfallToPolicy(
      selected.id,
      total,
      kind,
      "Simulated oracle report — controlled demo scenario (not real data)",
    );
    if (!updated) return toast.error("Policy is not in an evaluable state.");
    setOutcome({ policy: updated, paid: false });
    toast[kind === "low" ? "success" : "info"](
      `Rainfall recorded: ${total} mm vs ${updated.thresholdMm} mm threshold — ${isPayoutEligible(total, updated.thresholdMm) ? "payout eligible" : "no payout"}`,
    );
  }

  function payout() {
    if (!selected) return;
    const result = claimPayout(selected.id);
    if (result.ok && result.policy) {
      setOutcome({ policy: result.policy, paid: true });
      toast.success(`Payout of ${result.policy.coverageEth} ETH released for ${result.policy.id}`);
    } else {
      toast.error(`Claim rejected: ${result.reason}`);
    }
  }

  const steps = [
    { n: 1, title: "Create or pick a policy", done: Boolean(selected) },
    { n: 2, title: "Simulate rainfall", done: Boolean(selected?.rainfall) },
    { n: 3, title: "Trigger payout (if eligible)", done: Boolean(selected && selected.status === "paid") },
    { n: 4, title: "Verify the result", done: Boolean(outcome?.paid) },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader
        title="Demo Mode"
        description="The 2-minute flow: purchase a policy, simulate rainfall against its threshold, trigger an eligible payout and verify everything in the transparency ledger."
      />
      <div className="mb-6">
        <OnchainPendingNotice>
          Everything in this flow is clearly labelled simulated. When the contracts are deployed to
          Sepolia, the same flow runs against real testnet ETH with signed transactions.
        </OnchainPendingNotice>
      </div>

      {/* Stepper */}
      <div className="mb-6 grid gap-2 sm:grid-cols-4">
        {steps.map((s) => (
          <div
            key={s.n}
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm"
          >
            {s.done ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className={s.done ? "text-foreground" : "text-muted-foreground"}>{s.title}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Step 1 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FilePlus2 className="size-5 text-primary" /> Step 1 — Policy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={quickCreate}>
              <PlayCircle className="size-4" /> Quick-create demo policy
            </Button>
            <p className="text-xs text-muted-foreground">
              Cherrapunji · 30-day window · 50 mm threshold · 0.1 ETH coverage · 0.0075 ETH premium.
            </p>
            {demo.policies.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Or pick an existing one:</p>
                <div className="flex flex-wrap gap-2">
                  {demo.policies.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPolicyId(p.id)}
                      className={`rounded-md border px-2.5 py-1.5 font-mono text-xs transition-colors ${
                        selected?.id === p.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {p.id} · {p.status.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selected && (
              <p className="text-xs text-muted-foreground">
                Selected: {selected.id} — {selected.locationName}, threshold {selected.thresholdMm} mm,
                coverage {selected.coverageEth} ETH.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Step 2 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CloudRain className="size-5 text-accent" /> Step 2 — Simulate rainfall
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button variant="outline" disabled={!selected} onClick={() => simulate("low")}>
                Low rainfall (40% of threshold)
              </Button>
              <Button variant="outline" disabled={!selected} onClick={() => simulate("normal")}>
                Normal rainfall (160%)
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Applies a synthetic rainfall total to the selected policy and sets its eligibility.{" "}
              <SimulatedBadge />
            </p>
            {selected?.rainfall && (
              <div className="rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-xs">
                Recorded: <span className="font-mono">{selected.rainfall.totalMm} mm</span> vs threshold{" "}
                {selected.thresholdMm} mm → <PolicyStatusBadge status={selected.status} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 3 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Send className="size-5 text-primary" /> Step 3 — Trigger payout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button disabled={selected?.status !== "eligible"} onClick={payout}>
              Release automatic payout
            </Button>
            <p className="text-xs text-muted-foreground">
              The payout only triggers when rainfall is below the threshold, and each policy pays out
              at most once — the same rules the Solidity contract enforces.
            </p>
            {selected?.status === "not_eligible" && (
              <p className="text-xs text-warning">
                This policy is not eligible: recorded rainfall met or exceeded the threshold. Run the
                low-rainfall scenario on a fresh policy to see a payout.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Step 4 */}
        <Card className={outcome?.paid ? "card-glow border-success/40" : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="size-5 text-success" /> Step 4 — Result
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {outcome?.paid ? (
              <>
                <p>
                  Payout of <span className="font-mono text-success">{outcome.policy.coverageEth} ETH</span>{" "}
                  released for {outcome.policy.id} ({outcome.policy.locationName}).
                </p>
                <p className="text-xs text-muted-foreground">
                  Pool balance and utilization updated accordingly. This was a simulated payout — no
                  transaction was broadcast, so there is no hash to fabricate.
                </p>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/activity">View in Transparency</Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/pool">Check the pool</Link>
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Complete steps 1–3 to see the payout result here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

