import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarClock,
  CloudRain,
  Database,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { OnchainPendingNotice, SimulatedBadge } from "@/components/shared";
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
import {
  fetchWeatherOracle,
  getLiveDataConfig,
  submitWeatherReport,
} from "@/lib/oracle/server-fns";
import type {
  LiveDataConfig,
  RainfallPoint,
  WeatherIssue,
  WeatherSnapshot,
} from "@/lib/oracle/types";
import { isPayoutEligible } from "@/lib/premium";

export const Route = createFileRoute("/oracle")({
  head: () => ({
    meta: [
      { title: "Weather Oracle — SkyCover" },
      {
        name: "description",
        content:
          "Live rainfall observations from authoritative meteorological sources, shown alongside forecast rainfall and the oracle's verification status.",
      },
      { property: "og:title", content: "Weather Oracle — SkyCover" },
      {
        property: "og:description",
        content:
          "Observed and forecast rainfall with full source attribution and verification status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OraclePage,
});

/** Human wording for each machine-readable quality issue code. */
const ISSUE_LABELS: Record<WeatherIssue, string> = {
  "no-data": "No observation could be retrieved",
  stale: "Observation is older than 6 hours",
  "implausible-rainfall": "Rainfall is outside the plausible range",
  "unit-uncertain": "The source's unit could not be confirmed",
  "contradictory-sources": "Sources disagree beyond tolerance",
  "forecast-only": "Forecast only — no measured rainfall",
  "forecast-in-window": "The window contains forecast rainfall",
  "window-not-ended": "The coverage window has not ended yet",
  "out-of-range-coordinates": "Coordinates are out of range",
};

/**
 * A scenario is an explicitly-simulated reading. It is kept entirely separate
 * from the live snapshot so a simulated number can never be mistaken for an
 * observation, and so it is always badged as such.
 */
interface Scenario {
  kind: "low" | "normal";
  label: string;
  totalMm: number;
  daily: { at: string; mm: number }[];
}

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
  return weights.map((w) => Math.round((w / sum) * total * 10) / 10);
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Hourly rainfall as columns. Observed hours are drawn in the primary rain
 * colour and forecast hours in a lighter shade, with an explicit legend, so the
 * two are never visually confused.
 */
function HourlyRainfallChart({ points }: { points: RainfallPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No hourly rainfall was returned for this location.
      </p>
    );
  }
  const max = Math.max(1, ...points.map((point) => point.mm));
  return (
    <div>
      <div
        className="flex h-40 items-end gap-[2px]"
        role="img"
        aria-label="Hourly rainfall in millimetres"
      >
        {points.map((point) => {
          const height = Math.max(point.mm > 0 ? 2 : 0, (point.mm / max) * 100);
          const time = point.at.slice(11, 16);
          return (
            <div
              key={`${point.kind}-${point.at}`}
              className="group relative flex-1 rounded-t-[2px] transition-opacity hover:opacity-80"
              style={{ height: `${height}%` }}
              title={`${point.at.replace("T", " ").slice(0, 16)} UTC · ${point.mm} mm · ${point.kind}`}
            >
              <span
                className={
                  point.kind === "observed"
                    ? "absolute inset-0 rounded-t-[2px] bg-rain"
                    : "absolute inset-0 rounded-t-[2px] border border-dashed border-rain/60 bg-rain/20"
                }
              />
              <span className="pointer-events-none absolute inset-x-0 -top-5 hidden text-center font-mono text-[9px] text-muted-foreground group-hover:block">
                {time}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[0.6875rem] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-rain" /> Observed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] border border-dashed border-rain/60 bg-rain/20" />{" "}
          Forecast
        </span>
        <span className="ml-auto">Scale: 0 – {max.toFixed(1)} mm/hour</span>
      </div>
    </div>
  );
}

function OraclePage() {
  const demo = useDemoState();
  const [config, setConfig] = useState<LiveDataConfig | null>(null);
  const [locationIdx, setLocationIdx] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [manualRainfall, setManualRainfall] = useState("45.0");
  const [reporting, setReporting] = useState(false);
  const [oracleReporting, setOracleReporting] = useState(false);

  const activePolicies = demo.policies.filter((p) => p.status === "active");
  const location = LOCATION_PRESETS[Number(locationIdx)] ?? LOCATION_PRESETS[0]!;

  // Default the coverage window to the last 30 days, ending today, so a claim
  // window is complete the moment the page loads.
  useEffect(() => {
    if (startDate && endDate) return;
    setEndDate(isoDay(0));
    setStartDate(isoDay(-29));
  }, [startDate, endDate]);

  useEffect(() => {
    let cancelled = false;
    getLiveDataConfig()
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch(() => {
        // A missing configuration view is not fatal: the snapshot endpoint
        // reports its own availability.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSnapshot = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      if (!startDate || !endDate) return;
      setFetching(true);
      setError(null);
      setScenario(null);
      try {
        const result = await fetchWeatherOracle({
          data: {
            location: {
              name: location.name,
              latitude: location.latitude,
              longitude: location.longitude,
            },
            startDate,
            endDate,
            refresh: options.refresh === true,
          },
        });
        if (result.ok) {
          setSnapshot(result.snapshot);
        } else {
          setSnapshot(null);
          setError(result.reason);
          toast.error(result.reason);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Live rainfall data could not be retrieved.";
        setSnapshot(null);
        setError(message);
        toast.error(message);
      } finally {
        setFetching(false);
      }
    },
    [endDate, location.latitude, location.longitude, location.name, startDate],
  );

  function runScenario(kind: "low" | "normal") {
    const policy = activePolicies.find((p) => p.id === selectedPolicyId) ?? activePolicies[0];
    const threshold = policy?.thresholdMm ?? 50;
    const days = Math.max(
      1,
      Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1 || 30,
    );
    const total =
      kind === "low"
        ? Math.round(threshold * 0.4 * 10) / 10
        : Math.round(threshold * 1.6 * 10) / 10;
    const perDay = scenarioRainfall(policy?.id ?? "SC-0000", total, Math.min(days, 30));
    const baseMs = Date.parse(startDate || "2026-01-01");
    setSnapshot(null);
    setError(null);
    setScenario({
      kind,
      label: kind === "low" ? "Dry Season Scenario" : "Normal Rainfall Scenario",
      totalMm: total,
      daily: perDay.map((mm, i) => ({
        at: new Date(baseMs + i * 86_400_000).toISOString().slice(0, 10),
        mm,
      })),
    });
    toast.info(`Running ${kind} rainfall scenario`);
  }

  function runManualScenario() {
    const mm = parseFloat(manualRainfall);
    if (Number.isNaN(mm) || mm < 0) {
      toast.error("Please enter a valid rainfall amount (mm)");
      return;
    }
    const days = Math.max(
      1,
      Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1 || 30,
    );
    const perDay = scenarioRainfall(selectedPolicyId || "SC-0000", mm, Math.min(days, 30));
    const baseMs = Date.parse(startDate || "2026-01-01");
    setSnapshot(null);
    setError(null);
    setScenario({
      kind: "low",
      label: "Manual Simulation",
      totalMm: mm,
      daily: perDay.map((value, i) => ({
        at: new Date(baseMs + i * 86_400_000).toISOString().slice(0, 10),
        mm: value,
      })),
    });
    toast.info(`Generated simulation for ${mm} mm`);
  }

  /** The single number the report would use: live, or explicitly simulated. */
  const activeTotalMm = scenario ? scenario.totalMm : (snapshot?.windowTotalMm ?? null);
  const activeSource = scenario
    ? "Simulated oracle report (not an observation)"
    : (snapshot?.sources[0]?.name ?? "");

  /** Observed and forecast hours for the chart, kept visually distinct. */
  const chartPoints = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.observedHourly.slice(-48), ...snapshot.forecastHourly.slice(0, 24)];
  }, [snapshot]);

  const selectedPolicy = activePolicies.find((p) => p.id === selectedPolicyId) ?? null;
  const serverReportAvailable =
    config?.oracleReporting.enabled === true &&
    snapshot?.quality.claimGrade === true &&
    selectedPolicy?.onchainPolicyId !== undefined;

  async function evaluate(policyId: string) {
    if (activeTotalMm === null) return;
    const target = activePolicies.find((p) => p.id === policyId) ?? activePolicies[0];
    if (!target) return;

    setReporting(true);
    let txHash: string | undefined;
    try {
      if (isOnchainEnabled() && target.onchainPolicyId !== undefined) {
        const result = await reportRainfallOnchain(target.onchainPolicyId, activeTotalMm);
        txHash = result.txHash;
      }

      const policy: DemoPolicy | null = applyRainfallToPolicy(
        target.id,
        activeTotalMm,
        scenario ? scenario.kind : "real",
        activeSource,
        txHash,
      );
      if (policy) {
        const eligible = isPayoutEligible(activeTotalMm, policy.thresholdMm);
        if (eligible) {
          toast.success("Policy Eligible!", {
            description: `Rainfall (${activeTotalMm} mm) is below the ${policy.thresholdMm} mm threshold.`,
          });
        } else {
          toast.info("No Payout", {
            description: `Rainfall (${activeTotalMm} mm) met or exceeded the ${policy.thresholdMm} mm threshold.`,
          });
        }
        setScenario(null);
        setSnapshot(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Oracle transaction failed");
    } finally {
      setReporting(false);
    }
  }

  /** Submit through the server-side, key-authorised oracle path. */
  async function reportThroughOracle() {
    if (!selectedPolicy || selectedPolicy.onchainPolicyId === undefined) return;
    setOracleReporting(true);
    try {
      const outcome = await submitWeatherReport({
        data: {
          policyId: selectedPolicy.onchainPolicyId,
          location: {
            name: location.name,
            latitude: location.latitude,
            longitude: location.longitude,
          },
          startDate,
          endDate,
        },
      });
      if (outcome.submitted) {
        toast.success("Verified rainfall reported on-chain", {
          description: outcome.txHash
            ? `Transaction ${outcome.txHash.slice(0, 12)}… mined.`
            : undefined,
        });
      } else {
        toast.error("Oracle report refused", { description: outcome.reason ?? undefined });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Oracle report failed");
    } finally {
      setOracleReporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-20">
      <div className="mx-auto max-w-4xl text-center">
        <Badge variant="outline" className="border-rain/40 bg-rain/12 text-rain-strong">
          Weather Oracle
        </Badge>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Live Weather Oracle
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted-foreground">
          Observed rainfall from authoritative sources, with forecast rainfall shown separately and
          every reading carrying its source and observation time.
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
                <Label
                  htmlFor="oloc"
                  className="text-[0.8125rem] font-medium text-muted-foreground"
                >
                  Reference Location
                </Label>
                <select
                  id="oloc"
                  value={locationIdx}
                  onChange={(e) => setLocationIdx(e.target.value)}
                  className="h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  {LOCATION_PRESETS.map((l, i) => (
                    <option key={l.name} value={i} className="bg-card">
                      {l.name}
                    </option>
                  ))}
                </select>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3.5" /> {location.latitude}°N, {location.longitude}°E ·{" "}
                  {location.region}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label
                    htmlFor="ostart"
                    className="text-[0.8125rem] font-medium text-muted-foreground"
                  >
                    Coverage start
                  </Label>
                  <Input
                    id="ostart"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-10 border-input bg-card"
                  />
                </div>
                <div className="grid gap-2">
                  <Label
                    htmlFor="oend"
                    className="text-[0.8125rem] font-medium text-muted-foreground"
                  >
                    Coverage end
                  </Label>
                  <Input
                    id="oend"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-10 border-input bg-card"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => void loadSnapshot()}
                  disabled={fetching || !startDate || !endDate}
                  className="h-11 flex-1 font-semibold"
                >
                  {fetching ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <CloudRain className="mr-2 size-4" />
                  )}
                  {fetching ? "Retrieving observation…" : "Fetch live rainfall"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void loadSnapshot({ refresh: true })}
                  disabled={fetching || !startDate || !endDate}
                  className="h-11 px-3"
                  title="Bypass the cache and re-fetch"
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>

              <div className="rounded-xl bg-secondary/60 p-4 text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Live sources:</span> Open-Meteo
                structured rainfall (keyless, always on)
                {config?.weather.crossCheckEnabled
                  ? " · India Meteorological Department cross-check enabled via TinyFish"
                  : " · IMD cross-check unavailable until TINYFISH_API_KEY is set"}
                .
              </div>

              <div className="rounded-2xl border border-amber/30 bg-amber/8 p-5">
                <div className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-amber-strong">
                  <Sparkles className="size-3.5" /> Simulation Controls
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Generate controlled rainfall data to test policy logic. Simulated readings never
                  mix with live observations.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runScenario("low")}
                    className="h-9 flex-1 text-xs font-medium border-amber/35 hover:bg-amber/10 hover:text-amber-strong"
                  >
                    Dry Season
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runScenario("normal")}
                    className="h-9 flex-1 text-xs font-medium border-amber/35 hover:bg-amber/10 hover:text-amber-strong"
                  >
                    Normal
                  </Button>
                </div>

                <div className="mt-6 space-y-2 border-t border-amber/20 pt-4">
                  <Label
                    htmlFor="manual"
                    className="text-[0.8125rem] font-medium text-muted-foreground"
                  >
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
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={runManualScenario}
                      className="h-9 px-4 text-xs font-medium"
                    >
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
                <Label
                  htmlFor="opolicy"
                  className="text-[0.8125rem] font-medium text-muted-foreground"
                >
                  Target Policy
                </Label>
                <select
                  id="opolicy"
                  value={selectedPolicyId}
                  onChange={(e) => setSelectedPolicyId(e.target.value)}
                  className="h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <option value="" className="bg-card">
                    Select an active policy
                  </option>
                  {activePolicies.map((p) => (
                    <option key={p.id} value={p.id} className="bg-card">
                      {p.id} — {p.locationName} ({p.thresholdMm}mm)
                    </option>
                  ))}
                </select>
              </div>
              <Button
                disabled={activeTotalMm === null || activePolicies.length === 0 || reporting}
                onClick={() => void evaluate(selectedPolicyId || activePolicies[0]?.id || "")}
                className="h-11 w-full font-semibold"
              >
                {reporting ? "Confirm in MetaMask…" : "Evaluate & Report"}
              </Button>

              {serverReportAvailable && (
                <Button
                  variant="outline"
                  disabled={oracleReporting}
                  onClick={() => void reportThroughOracle()}
                  className="h-11 w-full font-semibold"
                >
                  {oracleReporting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-2 size-4" />
                  )}
                  {oracleReporting ? "Submitting verified report…" : "Submit via oracle account"}
                </Button>
              )}

              <OnchainPendingNotice>
                oracle reporting is not configured on this deployment, so the button above settles
                against the local demo ledger.
              </OnchainPendingNotice>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7 space-y-6">
          <Card className="border-border bg-card shadow-soft">
            <CardHeader className="border-b border-border pb-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-xl font-semibold">Rainfall Report</CardTitle>
                {scenario ? (
                  <SimulatedBadge className="border-amber/35 bg-amber/12 text-amber-strong">
                    {scenario.label}
                  </SimulatedBadge>
                ) : snapshot ? (
                  snapshot.quality.claimGrade ? (
                    <Badge variant="outline" className="border-sage/40 bg-sage/12 text-sage-strong">
                      <ShieldCheck /> Verified — claim grade
                    </Badge>
                  ) : snapshot.quality.ok ? (
                    <Badge
                      variant="outline"
                      className="border-amber/40 bg-amber/12 text-amber-strong"
                    >
                      <ShieldAlert /> Retrieved — not claim grade
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-destructive/40 bg-destructive/10 text-destructive"
                    >
                      <ShieldAlert /> Rejected
                    </Badge>
                  )
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="pt-8">
              {!snapshot && !scenario ? (
                <div className="flex flex-col items-center justify-center py-32 text-center text-muted-foreground">
                  <CloudRain className="mb-4 size-16 text-rain/50" />
                  <p className="text-lg font-medium">
                    {error ? "Live data unavailable" : "Awaiting data input"}
                  </p>
                  <p className="mt-1 max-w-sm text-sm">
                    {error ?? "Fetch the live observation for the selected location and window."}
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Window total (observed)
                      </div>
                      <div className="flex items-end gap-2">
                        <span className="font-display text-4xl font-semibold text-rain-strong">
                          {activeTotalMm ?? "—"}
                        </span>
                        <span className="mb-1.5 text-lg font-medium text-muted-foreground">mm</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Current hour
                      </div>
                      <div className="flex items-end gap-2">
                        <span className="font-display text-4xl font-semibold text-foreground">
                          {scenario ? "—" : (snapshot?.currentMm ?? "—")}
                        </span>
                        <span className="mb-1.5 text-lg font-medium text-muted-foreground">mm</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Today (observed)
                      </div>
                      <div className="flex items-end gap-2">
                        <span className="font-display text-4xl font-semibold text-foreground">
                          {scenario ? "—" : (snapshot?.todayMm ?? "—")}
                        </span>
                        <span className="mb-1.5 text-lg font-medium text-muted-foreground">mm</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Location
                    </div>
                    <div className="flex items-center gap-2 text-lg font-semibold">
                      <MapPin className="size-4 text-rain" /> {location.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {location.latitude}°N, {location.longitude}°E · window {startDate} → {endDate}
                    </div>
                  </div>

                  <div className="rounded-xl bg-secondary/60 p-4 text-xs leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground">Source:</span>{" "}
                    {activeSource || "—"}
                    <br />
                    <span className="font-semibold text-foreground">Observed through:</span>{" "}
                    {scenario
                      ? "simulated"
                      : snapshot?.observedThrough
                        ? new Date(snapshot.observedThrough).toLocaleString()
                        : "—"}
                    {" · "}
                    <span className="font-semibold text-foreground">Retrieved:</span>{" "}
                    {scenario
                      ? new Date().toLocaleString()
                      : snapshot
                        ? new Date(snapshot.fetchedAt).toLocaleString()
                        : "—"}
                    {snapshot?.timezone ? ` · ${snapshot.timezone}` : ""}
                    {snapshot?.cached ? " · served from cache" : ""}
                  </div>

                  {snapshot && snapshot.quality.issues.length > 0 && (
                    <div className="rounded-xl border border-amber/30 bg-amber/8 p-4 text-xs leading-relaxed text-amber-strong">
                      <div className="font-semibold">Verification notes</div>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {snapshot.quality.issues.map((issue) => (
                          <li key={issue}>{ISSUE_LABELS[issue]}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {snapshot && (
                    <div className="space-y-3">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Hourly rainfall — last 48 observed hours with the next 24 forecast
                      </div>
                      <HourlyRainfallChart points={chartPoints} />
                    </div>
                  )}

                  {snapshot && snapshot.forecastDaily.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Forecast rainfall (never used for a claim)
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {snapshot.forecastDaily.slice(0, 4).map((day) => (
                          <div
                            key={day.at}
                            className="rounded-xl border border-dashed border-rain/40 bg-rain/5 p-3"
                          >
                            <div className="font-mono text-[0.6875rem] text-muted-foreground">
                              {day.at.slice(5)}
                            </div>
                            <div className="mt-1 font-display text-xl font-semibold text-rain-strong">
                              {day.mm}
                              <span className="ml-1 text-xs font-medium text-muted-foreground">
                                mm
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="overflow-hidden rounded-2xl border border-border bg-secondary/40">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-border bg-secondary/60 text-left text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          <th className="px-6 py-4">Observation Date</th>
                          <th className="px-6 py-4 text-right">Rainfall (mm)</th>
                          <th className="px-6 py-4 text-right">Kind</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {(scenario
                          ? scenario.daily.map((d) => ({
                              at: d.at,
                              mm: d.mm,
                              kind: "simulated" as const,
                            }))
                          : snapshot!.observedDaily
                              .slice(-14)
                              .map((d) => ({ at: d.at, mm: d.mm, kind: "observed" as const }))
                        ).map((d) => (
                          <tr
                            key={`${d.kind}-${d.at}`}
                            className="transition-colors hover:bg-rain/8"
                          >
                            <td className="px-6 py-3 font-mono text-muted-foreground">{d.at}</td>
                            <td className="px-6 py-3 text-right font-mono font-semibold text-foreground">
                              {d.mm}
                            </td>
                            <td className="px-6 py-3 text-right text-xs text-muted-foreground">
                              {d.kind}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {snapshot && snapshot.sources.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Sources
                      </div>
                      <ul className="space-y-1.5 text-xs text-muted-foreground">
                        {snapshot.sources.map((source) => (
                          <li
                            key={`${source.id}-${source.url}`}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <Badge
                              variant="outline"
                              className="border-border text-[0.625rem] uppercase"
                            >
                              {source.kind}
                            </Badge>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-rain-strong underline-offset-2 hover:underline"
                            >
                              {source.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                      {snapshot.crossCheck && (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            Cross-check ({snapshot.crossCheck.source.name}):
                          </span>{" "}
                          {snapshot.crossCheck.mm === null
                            ? "no figure stated"
                            : `${snapshot.crossCheck.mm} mm`}{" "}
                          — {snapshot.crossCheck.note}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3 rounded-xl bg-lavender/10 p-4 text-[12px] leading-relaxed text-foreground ring-1 ring-lavender/25">
                    <Info className="size-5 shrink-0 text-lavender-strong" />
                    Policies settle on the observed window total. Forecast rainfall is displayed for
                    context only and is never submitted to the insurance contract.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <CalendarClock className="size-4 text-rain" /> How verification works
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <p>
                1. A reading is taken from a structured meteorological source and attributed to its
                URL and timestamp.
              </p>
              <p>
                2. It is checked against the policy's own location, window and unit, and rejected if
                stale, incomplete or contradictory.
              </p>
              <p>
                3. Only a claim-grade observation is submitted, and only by the authorised oracle
                account the contract already trusts.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
