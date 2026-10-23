import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, CloudRain, Database, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { OnchainPendingNotice, PageHeader, SimulatedBadge } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDemoState } from "@/hooks/use-demo-state";
import { applyRainfallToPolicy, type DemoPolicy } from "@/lib/demo";
import { LOCATION_PRESETS } from "@/lib/locations";
import { isPayoutEligible } from "@/lib/premium";
import { fetchRainfall, type RainfallReport } from "@/lib/weather";

export const Route = createFileRoute("/oracle")({
  head: () => ({
    meta: [
      { title: "Weather Oracle — SkyCover" },
      {
        name: "description",
        content:
          "Inspect real rainfall data from the Open-Meteo archive, or run controlled low-rainfall and normal-rainfall scenarios against a policy.",
      },
      { property: "og:title", content: "Weather Oracle — SkyCover" },
      {
        property: "og:description",
        content: "Real rainfall data and controlled demo scenarios, with timestamps and sources.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OraclePage,
});

/** Deterministic pseudo-random so a scenario replay looks stable in a demo. */
function scenarioRainfall(seedPolicyId: string, total: number, days: number): number[] {
  let seed = 0;
  for (const ch of seedPolicyId) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  const weights: number[] = [];
  let sum = 0;
  for (let i = 0; i < days; i++) {
    seed = (seed * 137 + 71) % 9973;
    const w = 1 + (seed % 100) / 100;
    weights.push(w);
    sum += w;
  }
  return weights.map((w) => Math.round(((w / sum) * total) * 10) / 10);
}

function OraclePage() {
  const demo = useDemoState();
  const [locationIdx, setLocationIdx] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [realReport, setRealReport] = useState<RainfallReport | null>(null);
  const [fetching, setFetching] = useState(false);
  const [scenario, setScenario] = useState<{ kind: "low" | "normal"; label: string; report: RainfallReport } | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState("");

  const activePolicies = demo.policies.filter((p) => p.status === "active");
  const location = LOCATION_PRESETS[Number(locationIdx)] ?? LOCATION_PRESETS[0]!;
  const report = scenario?.report ?? realReport;

  // Default the range to the last 30 days once hydrated (avoids SSR/client mismatch).
  useEffect(() => {
    if (startDate && endDate) return;
    const end = new Date(Date.now() - 5 * 86_400_000);
    const start = new Date(end.getTime() - 29 * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    setStartDate(iso(start));
    setEndDate(iso(end));
  }, [startDate, endDate]);

  async function fetchReal() {
    if (!startDate || !endDate) return;
    setFetching(true);
    setScenario(null);
    try {
      const result = await fetchRainfall({
        data: { latitude: location.latitude, longitude: location.longitude, startDate, endDate },
      });
      setRealReport(result);
      if (!result.daily.length) toast.error("No rainfall data returned for this range.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Open-Meteo request failed");
    } finally {
      setFetching(false);
    }
  }

  function runScenario(kind: "low" | "normal") {
    const policy = activePolicies.find((p) => p.id === selectedPolicyId) ?? activePolicies[0];
    const threshold = policy?.thresholdMm ?? 50;
    const days = Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1 || 30);
    const total = kind === "low" ? Math.round(threshold * 0.4 * 10) / 10 : Math.round(threshold * 1.6 * 10) / 10;
    const perDay = scenarioRainfall(policy?.id ?? "SC-0000", total, Math.min(days, 30));
    const baseMs = Date.parse(startDate || "2026-01-01");
    setRealReport(null);
    setScenario({
      kind,
      label: kind === "low" ? "Low-rainfall scenario" : "Normal-rainfall scenario",
      report: {
        source: `Simulated oracle report — ${kind === "low" ? "dry" : "normal"} season (not real data)`,
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: "simulated",
        unit: "mm",
        daily: perDay.map((mm, i) => ({
          date: new Date(baseMs + i * 86_400_000).toISOString().slice(0, 10),
          mm,
        })),
        totalMm: total,
        fetchedAt: new Date().toISOString(),
      },
    });
  }

  function evaluate(policyId: string) {
    if (!report) return;
    const policy: DemoPolicy | null = applyRainfallToPolicy(
      policyId,
      report.totalMm,
      scenario ? scenario.kind : "real",
      report.source,
    );
    if (policy) {
      const eligible = isPayoutEligible(report.totalMm, policy.thresholdMm);
      toast[eligible ? "success" : "info"](
        `${policy.id}: ${eligible ? "payout eligible — rainfall below threshold" : "no payout — rainfall met the threshold"}`,
      );
      setScenario(null);
      setRealReport(null);
    } else {
      toast.error("Only active policies can be evaluated.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader
        title="Weather Oracle"
        description="Fetch real rainfall observations from Open-Meteo, or run controlled low/normal rainfall scenarios and apply them to a policy."
      />
      <div className="mb-6">
        <OnchainPendingNotice>
          In production a authorized oracle contract signs rainfall reports on-chain. Until that
          contract is deployed, oracle reports here are fetched off-chain from Open-Meteo, and
          simulated scenarios are labelled as such.
        </OnchainPendingNotice>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="size-5 text-primary" /> Data source
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="oloc">Location</Label>
              <select
                id="oloc"
                value={locationIdx}
                onChange={(e) => setLocationIdx(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {LOCATION_PRESETS.map((l, i) => (
                  <option key={l.name} value={i}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ostart">From</Label>
                <Input id="ostart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="oend">To</Label>
                <Input id="oend" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <Button onClick={fetchReal} disabled={fetching || !startDate || !endDate}>
              <CloudRain className="size-4" />
              {fetching ? "Fetching rainfall…" : "Fetch real rainfall (Open-Meteo)"}
            </Button>

            <div className="rounded-lg border border-dashed border-warning/40 bg-warning/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <Sparkles className="size-3.5" /> Controlled demo scenarios
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Generate a synthetic rainfall series to demo both outcomes. Uses the selected
                policy's threshold when one is chosen.
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => runScenario("low")}>
                  Low rainfall
                </Button>
                <Button size="sm" variant="outline" onClick={() => runScenario("normal")}>
                  Normal rainfall
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="opolicy">Apply report to policy</Label>
              <select
                id="opolicy"
                value={selectedPolicyId}
                onChange={(e) => setSelectedPolicyId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">First active policy</option>
                {activePolicies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} — {p.locationName} (threshold {p.thresholdMm} mm)
                  </option>
                ))}
              </select>
              <Button disabled={!report || activePolicies.length === 0} onClick={() => evaluate(selectedPolicyId || activePolicies[0]?.id || "")}>
                Evaluate policy
              </Button>
              {activePolicies.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No active policies — create one on the Buy Insurance page first.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">Rainfall report</CardTitle>
          </CardHeader>
          <CardContent>
            {!report ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Fetch real data or run a scenario to see the report.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className="border-primary/40 text-primary">
                    Total: {report.totalMm} {report.unit}
                  </Badge>
                  {scenario ? <SimulatedBadge>{scenario.label}</SimulatedBadge> : (
                    <Badge variant="outline" className="border-success/40 text-success">
                      Real data
                    </Badge>
                  )}
                  <Badge variant="outline">{location.name}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Source: {report.source}
                  <br />
                  {scenario ? "Generated" : "Retrieved"} {new Date(report.fetchedAt).toUTCString()} ·
                  timezone: {report.timezone} · coordinates {report.latitude}, {report.longitude}
                </p>
                <div className="max-h-96 overflow-y-auto rounded-lg border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-secondary text-left text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Rainfall ({report.unit})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.daily.map((d) => (
                        <tr key={d.date} className="border-t border-border/40">
                          <td className="px-3 py-1.5 font-mono">{d.date}</td>
                          <td className="px-3 py-1.5 font-mono">{d.mm}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="size-3.5" />
                  A policy pays out when the window total is strictly below its threshold.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
