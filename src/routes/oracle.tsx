import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, CloudRain, Database, Info, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { OnchainPendingNotice, PageHeader, SimulatedBadge } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDemoState } from "@/hooks/use-demo-state";
import { isOnchainEnabled } from "@/lib/chain";
import { reportRainfallOnchain } from "@/lib/contract";
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
  const [manualRainfall, setManualRainfall] = useState("45.0");
  const [reporting, setReporting] = useState(false);

  const activePolicies = demo.policies.filter((p) => p.status === "active");
  const location = LOCATION_PRESETS[Number(locationIdx)] ?? LOCATION_PRESETS[0]!;
  const report = scenario?.report ?? realReport;

  // Default the range to the last 30 days once hydrated
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

  function runManualScenario() {
    const mm = parseFloat(manualRainfall);
    if (isNaN(mm) || mm < 0) {
      toast.error("Please enter a valid rainfall amount (mm)");
      return;
    }

    const policy = activePolicies.find((p) => p.id === selectedPolicyId) ?? activePolicies[0];
    const days = Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1 || 30);
    const perDay = scenarioRainfall(policy?.id ?? "SC-0000", mm, Math.min(days, 30));
    const baseMs = Date.parse(startDate || "2026-01-01");

    setRealReport(null);
    setScenario({
      kind: "low",
      label: "Manual Simulation",
      report: {
        source: "Manual entry (simulation)",
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: "simulated",
        unit: "mm",
        daily: perDay.map((mmVal, i) => ({
          date: new Date(baseMs + i * 86_400_000).toISOString().slice(0, 10),
          mm: mmVal,
        })),
        totalMm: mm,
        fetchedAt: new Date().toISOString(),
      },
    });
    toast.info(`Generated simulation for ${mm} mm`);
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
      label: kind === "low" ? "Dry Season Scenario" : "Normal Rainfall Scenario",
      report: {
        source: `Simulated oracle report — ${kind === "low" ? "dry" : "normal"} season`,
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: "simulated",
        unit: "mm",
        daily: perDay.map((mmVal, i) => ({
          date: new Date(baseMs + i * 86_400_000).toISOString().slice(0, 10),
          mm: mmVal,
        })),
        totalMm: total,
        fetchedAt: new Date().toISOString(),
      },
    });
    toast.info(`Running ${kind} rainfall scenario`);
  }

  async function evaluate(policyId: string) {
    if (!report) return;
    const target = activePolicies.find((p) => p.id === policyId) ?? activePolicies[0];
    if (!target) return;

    setReporting(true);
    let txHash: string | undefined;
    try {
      if (isOnchainEnabled() && target.onchainPolicyId !== undefined) {
        const result = await reportRainfallOnchain(target.onchainPolicyId, report.totalMm);
        txHash = result.txHash;
      }

      const policy: DemoPolicy | null = applyRainfallToPolicy(
        target.id,
        report.totalMm,
        scenario ? scenario.kind : "real",
        report.source,
        txHash,
      );
      if (policy) {
        const eligible = isPayoutEligible(report.totalMm, policy.thresholdMm);
        if (eligible) {
          toast.success("Policy Eligible!", {
            description: `Rainfall (${report.totalMm} mm) is below the ${policy.thresholdMm} mm threshold.`,
          });
        } else {
          toast.info("No Payout", {
            description: `Rainfall (${report.totalMm} mm) met or exceeded the ${policy.thresholdMm} mm threshold.`,
          });
        }
        setScenario(null);
        setRealReport(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Oracle transaction failed");
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-20">
      <div className="mx-auto max-w-4xl text-center">
        <Badge variant="outline" className="border-rain/40 bg-rain/12 text-rain-strong">Weather Oracle</Badge>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Verify Climate Events</h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted-foreground">
          Fetch real-world observations or simulate controlled scenarios to verify policy outcomes.
        </p>
      </div>

      <div className="mt-14 grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5 space-y-6">
          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <Database className="size-5 text-rain" /> Data Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-2">
                <Label htmlFor="oloc" className="text-[0.8125rem] font-medium text-muted-foreground">Reference Location</Label>
                <select
                  id="oloc"
                  value={locationIdx}
                  onChange={(e) => setLocationIdx(e.target.value)}
                  className="h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  {LOCATION_PRESETS.map((l, i) => (
                    <option key={l.name} value={i} className="bg-card">{l.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="ostart" className="text-[0.8125rem] font-medium text-muted-foreground">Start</Label>
                  <Input id="ostart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10 border-input bg-card" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="oend" className="text-[0.8125rem] font-medium text-muted-foreground">End</Label>
                  <Input id="oend" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10 border-input bg-card" />
                </div>
              </div>

              <Button onClick={fetchReal} disabled={fetching || !startDate || !endDate} className="h-11 font-semibold">
                <CloudRain className="mr-2 size-4" />
                {fetching ? "Retrieving Observation..." : "Fetch Open-Meteo Data"}
              </Button>

              <div className="rounded-2xl border border-amber/30 bg-amber/8 p-5">
                <div className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-amber-strong">
                  <Sparkles className="size-3.5" /> Simulation Controls
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Generate controlled rainfall data to test policy logic.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => runScenario("low")} className="h-9 flex-1 text-xs font-medium border-amber/35 hover:bg-amber/10 hover:text-amber-strong">
                    Dry Season
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => runScenario("normal")} className="h-9 flex-1 text-xs font-medium border-amber/35 hover:bg-amber/10 hover:text-amber-strong">
                    Normal
                  </Button>
                </div>

                <div className="mt-6 space-y-2 border-t border-amber/20 pt-4">
                  <Label htmlFor="manual" className="text-[0.8125rem] font-medium text-muted-foreground">
                    Custom Rainfall (mm)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="manual"
                      type="number"
                      value={manualRainfall}
                      onChange={(e) => setManualRainfall(e.target.value)}
                      className="h-9 border-amber/35 bg-card text-xs font-mono"
                    />
                    <Button size="sm" variant="secondary" onClick={runManualScenario} className="h-9 px-4 text-xs font-medium">
                      Inject
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">Oracle Action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="opolicy" className="text-[0.8125rem] font-medium text-muted-foreground">Target Policy</Label>
                <select
                  id="opolicy"
                  value={selectedPolicyId}
                  onChange={(e) => setSelectedPolicyId(e.target.value)}
                  className="h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="" className="bg-card">Select an active policy</option>
                  {activePolicies.map((p) => (
                    <option key={p.id} value={p.id} className="bg-card">
                      {p.id} — {p.locationName} ({p.thresholdMm}mm)
                    </option>
                  ))}
                </select>
              </div>
              <Button
                disabled={!report || activePolicies.length === 0 || reporting}
                onClick={() => void evaluate(selectedPolicyId || activePolicies[0]?.id || "")}
                className="h-11 w-full font-semibold"
              >
                {reporting ? "Confirm in MetaMask…" : "Evaluate & Report"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7">
          <Card className="h-full border-border bg-card shadow-soft">
            <CardHeader className="border-b border-border pb-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl font-semibold">Rainfall Report</CardTitle>
                {report && (
                  <div className="flex gap-2">
                    {scenario ? <SimulatedBadge className="border-amber/35 bg-amber/12 text-amber-strong">{scenario.label}</SimulatedBadge> : (
                      <Badge variant="outline" className="border-sage/40 bg-sage/12 text-sage-strong">Verified Data</Badge>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-8">
              {!report ? (
                <div className="flex flex-col items-center justify-center py-32 text-center text-muted-foreground">
                  <CloudRain className="mb-4 size-16 text-rain/50" />
                  <p className="text-lg font-medium">Awaiting Data Input</p>
                  <p className="mt-1 text-sm">Fetch real-world data or run a simulation to generate a report.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">Aggregate Total</div>
                      <div className="flex items-end gap-2">
                        <span className="font-display text-4xl font-semibold text-rain-strong">{report.totalMm}</span>
                        <span className="mb-1.5 text-lg font-medium text-muted-foreground">{report.unit}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">Location Context</div>
                      <div className="text-lg font-semibold">{location.name}</div>
                      <div className="text-xs text-muted-foreground">{report.latitude}°N, {report.longitude}°E</div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-secondary/60 p-4 text-xs leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground">Provenance:</span> {report.source}
                    <br />
                    <span className="font-semibold text-foreground">Timestamp:</span> {new Date(report.fetchedAt).toLocaleString()} · {report.timezone}
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-border bg-secondary/40">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-border bg-secondary/60 text-left text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          <th className="px-6 py-4">Observation Date</th>
                          <th className="px-6 py-4 text-right">Rainfall ({report.unit})</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {report.daily.map((d) => (
                          <tr key={d.date} className="transition-colors hover:bg-rain/8">
                            <td className="px-6 py-3 font-mono text-muted-foreground">{d.date}</td>
                            <td className="px-6 py-3 text-right font-mono font-semibold text-foreground">{d.mm}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center gap-3 rounded-xl bg-lavender/10 p-4 text-[12px] leading-relaxed text-foreground ring-1 ring-lavender/25">
                    <Info className="size-5 shrink-0 text-lavender-strong" />
                    Policies are evaluated on the total rainfall over the defined coverage window. A payout is triggered when the total is below the policyholder's chosen threshold.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
