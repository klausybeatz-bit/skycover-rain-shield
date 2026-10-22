import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Calculator, CloudRain, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader, OnchainPendingNotice } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/components/wallet-provider";
import { isOnchainEnabled } from "@/lib/chain";
import { createDemoPolicy } from "@/lib/demo";
import { LOCATION_PRESETS, PERSONA_LABEL } from "@/lib/locations";
import { calculatePremium, coverageDays } from "@/lib/premium";

export const Route = createFileRoute("/buy")({
  head: () => ({
    meta: [
      { title: "Buy Rain Insurance — SkyCover" },
      {
        name: "description",
        content:
          "Choose a location, coverage dates, rainfall threshold and payout amount. SkyCover calculates your premium transparently before you commit.",
      },
      { property: "og:title", content: "Buy Rain Insurance — SkyCover" },
      {
        property: "og:description",
        content: "Build a parametric rain policy with a transparent premium in under a minute.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BuyPage,
});

function BuyPage() {
  const navigate = useNavigate();
  const wallet = useWallet();

  const [locationIdx, setLocationIdx] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [thresholdMm, setThresholdMm] = useState(50);
  const [coverageEth, setCoverageEth] = useState("0.1");

  const location = LOCATION_PRESETS[Number(locationIdx)] ?? LOCATION_PRESETS[0];
  const days = useMemo(
    () => (startDate && endDate ? coverageDays(startDate, endDate) : 0),
    [startDate, endDate],
  );
  const coverage = Number(coverageEth) || 0;
  const valid = days > 0 && coverage >= 0.01 && coverage <= 2 && thresholdMm >= 5;
  const breakdown = useMemo(
    () => (valid ? calculatePremium(coverage, thresholdMm, days) : null),
    [valid, coverage, thresholdMm, days],
  );

  function buyDemo() {
    if (!valid || !breakdown) return;
    const policy = createDemoPolicy({
      locationName: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      startDate,
      endDate,
      thresholdMm,
      coverageEth: coverage,
      premiumEth: breakdown.premiumEth,
      holderAddress: wallet.address,
    });
    toast.success(`Demo policy ${policy.id} created`, {
      description: "Simulated purchase — no transaction was sent. Next: simulate rainfall on the Weather Oracle page.",
    });
    navigate({ to: "/policies" });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader
        title="Buy Insurance"
        description="Set your cover, see exactly how the premium is calculated, then purchase. On-chain purchases settle through MetaMask on Sepolia."
      />
      <div className="mb-6">
        <OnchainPendingNotice>
          The insurance contract is not deployed yet, so purchases below run in demo mode: the policy
          is stored locally and every figure is labelled simulated. Connect MetaMask to see your real
          wallet balance and network.
        </OnchainPendingNotice>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Form */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CloudRain className="size-5 text-primary" /> Coverage details
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="location">Location</Label>
              <select
                id="location"
                value={locationIdx}
                onChange={(e) => setLocationIdx(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {LOCATION_PRESETS.map((l, i) => (
                  <option key={l.name} value={i}>
                    {l.name} — {PERSONA_LABEL[l.persona]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Coordinates: {location.latitude}, {location.longitude} · region: {location.region}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="start">Coverage start</Label>
                <Input
                  id="start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="end">Coverage end</Label>
                <Input
                  id="end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="threshold">
                Rainfall threshold: <span className="text-primary">{thresholdMm} mm total</span>
              </Label>
              <input
                id="threshold"
                type="range"
                min={5}
                max={200}
                step={5}
                value={thresholdMm}
                onChange={(e) => setThresholdMm(Number(e.target.value))}
                className="accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                If total rainfall over the coverage window is below this, the policy pays out. Higher
                thresholds are easier to breach, so the premium rises.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="coverage">Coverage amount (ETH)</Label>
              <Input
                id="coverage"
                type="number"
                min={0.01}
                max={2}
                step={0.01}
                value={coverageEth}
                onChange={(e) => setCoverageEth(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Testnet ETH (0.01–2). This is what the contract pays out if rainfall breaches the threshold.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Premium breakdown */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="card-glow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calculator className="size-5 text-accent" /> Premium breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              {breakdown ? (
                <div className="space-y-3 text-sm">
                  <Row label="Coverage amount" value={`${breakdown.coverageEth} ETH`} />
                  <Row label="Coverage window" value={`${breakdown.days} days`} />
                  <Row label="Rainfall threshold" value={`${breakdown.thresholdMm} mm`} />
                  <div className="h-px bg-border" />
                  <Row label="Base rate (per 30 days)" value={`${(breakdown.baseRate * 100).toFixed(1)}% of coverage`} />
                  <Row label="Duration factor" value={`${breakdown.days} / 30 = ${breakdown.dayFactor}`} />
                  <Row label="Threshold factor" value={`1 + ${breakdown.thresholdMm}/200 = ${breakdown.thresholdFactor}`} />
                  <div className="h-px bg-border" />
                  <div className="flex items-baseline justify-between rounded-lg bg-primary/10 px-3 py-3">
                    <span className="font-medium">Premium due</span>
                    <span className="font-display text-2xl font-semibold text-primary">
                      {breakdown.premiumEth} ETH
                    </span>
                  </div>
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    Premium = coverage × {(breakdown.baseRate * 100).toFixed(0)}% × duration factor ×
                    threshold factor. Paid once, upfront, into the liquidity pool.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Pick a coverage window and amount (0.01–2 ETH) to see the premium.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <Button className="w-full" size="lg" disabled={!valid} onClick={buyDemo}>
                Buy in Demo Mode
              </Button>
              <Button
                className="w-full"
                size="lg"
                variant="secondary"
                disabled={!isOnchainEnabled()}
                title={
                  isOnchainEnabled()
                    ? undefined
                    : "Requires the SkyCover insurance contract deployed on Sepolia"
                }
              >
                Buy on-chain with MetaMask
              </Button>
              {!isOnchainEnabled() && (
                <p className="text-xs text-muted-foreground">
                  On-chain buying activates automatically once the contract address is configured in{" "}
                  <code className="font-mono text-[11px]">src/lib/chain.ts</code>.
                </p>
              )}
              {valid && (
                <Badge variant="outline" className="border-primary/40 text-primary">
                  {location.name} · {startDate} → {endDate} · {thresholdMm} mm
                </Badge>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
