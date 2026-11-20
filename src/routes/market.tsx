import { createFileRoute } from "@tanstack/react-router";
import {
  ExternalLink,
  Info,
  Loader2,
  MapPin,
  Minus,
  RefreshCw,
  Sprout,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchMandiPrices, getLiveDataConfig } from "@/lib/oracle/server-fns";
import type { LiveDataConfig, MandiPrice, MandiPrices } from "@/lib/oracle/types";

export const Route = createFileRoute("/market")({
  head: () => ({
    meta: [
      { title: "Mandi Prices — SkyCover" },
      {
        name: "description",
        content:
          "Live Indian mandi prices for supported crops, sourced from official agricultural market data with min, max and modal prices.",
      },
      { property: "og:title", content: "Mandi Prices — SkyCover" },
      {
        property: "og:description",
        content:
          "Latest modal, minimum and maximum mandi prices per quintal, with source attribution.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketPage,
});

function formatInrPerQuintal(value: number | null): string {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Modal price trend across the retrieved history, oldest on the left. */
function PriceTrendChart({ rows }: { rows: MandiPrice[] }) {
  const priced = rows.filter((row) => row.modalInr !== null);
  if (priced.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Not enough dated price points were retrieved to draw a trend.
      </p>
    );
  }
  // `history` arrives newest-first; the chart reads left-to-right in time.
  const ascending = [...priced].reverse();
  const values = ascending.map((row) => row.modalInr as number);
  const max = Math.max(...values);
  const min = Math.min(...values);

  return (
    <div>
      <div
        className="flex h-40 items-end gap-1"
        role="img"
        aria-label="Modal mandi price trend in INR per quintal"
      >
        {ascending.map((row) => {
          const value = row.modalInr as number;
          const height = max > 0 ? Math.max(3, (value / max) * 100) : 3;
          return (
            <div
              key={`${row.priceDate ?? row.market ?? "row"}-${value}`}
              className="group relative flex-1 rounded-t-[2px] bg-terracotta transition-opacity hover:opacity-80"
              style={{ height: `${height}%` }}
              title={`${row.priceDate ?? "date unknown"} · ${formatInrPerQuintal(value)}/quintal${row.market ? ` · ${row.market}` : ""}`}
            >
              <span className="pointer-events-none absolute inset-x-0 -top-5 hidden whitespace-nowrap text-center font-mono text-[9px] text-muted-foreground group-hover:block">
                {row.priceDate?.slice(5) ?? ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[0.6875rem] text-muted-foreground">
        <span>Range across retrieved days</span>
        <span className="font-mono">
          {formatInrPerQuintal(min)} – {formatInrPerQuintal(max)} / quintal
        </span>
      </div>
    </div>
  );
}

function MarketPage() {
  const [config, setConfig] = useState<LiveDataConfig | null>(null);
  const [crop, setCrop] = useState("");
  const [stateName, setStateName] = useState("");
  const [district, setDistrict] = useState("");
  const [market, setMarket] = useState("");
  const [result, setResult] = useState<MandiPrices | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLiveDataConfig()
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setCrop((current) => current || next.crops[0] || "");
      })
      .catch(() => {
        // The configuration view is a convenience; a lookup can still be tried.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      if (!crop) {
        toast.error("Choose a crop to look up a price.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // Only present fields are sent; a blank filter must not become an
        // empty-string query, which would narrow the search to nothing.
        const data: {
          crop: string;
          refresh?: boolean;
          state?: string;
          district?: string;
          market?: string;
        } = { crop };
        if (options.refresh === true) data.refresh = true;
        if (stateName.trim()) data.state = stateName.trim();
        if (district.trim()) data.district = district.trim();
        if (market.trim()) data.market = market.trim();

        const next = await fetchMandiPrices({ data });
        setResult(next);
        if (!next.available)
          toast.error("Data unavailable", { description: next.reason ?? undefined });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Live market data could not be retrieved.";
        setResult(null);
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    },
    [crop, district, market, stateName],
  );

  const configReady = config !== null;
  const marketEnabled = config?.market.enabled ?? false;
  const latest = result?.latest ?? null;
  const change = result?.changePercent ?? null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-20">
      <div className="mx-auto max-w-4xl text-center">
        <Badge
          variant="outline"
          className="border-terracotta/40 bg-terracotta/12 text-terracotta-strong"
        >
          Market Data
        </Badge>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Live Mandi Market Prices
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted-foreground">
          Latest modal, minimum and maximum mandi prices per quintal, retrieved from official
          agricultural market sources and shown with their date and attribution.
        </p>
      </div>

      <div className="mt-14 grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <Sprout className="size-5 text-sage-strong" /> Market Query
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-2">
                <Label
                  htmlFor="mcrop"
                  className="text-[0.8125rem] font-medium text-muted-foreground"
                >
                  Crop / commodity
                </Label>
                <select
                  id="mcrop"
                  value={crop}
                  onChange={(e) => setCrop(e.target.value)}
                  disabled={!configReady}
                  className="h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
                >
                  {(config?.crops ?? []).map((name) => (
                    <option key={name} value={name} className="bg-card">
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label
                    htmlFor="mstate"
                    className="text-[0.8125rem] font-medium text-muted-foreground"
                  >
                    State (optional)
                  </Label>
                  <Input
                    id="mstate"
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                    placeholder="e.g. Maharashtra"
                    className="h-10 border-input bg-card"
                  />
                </div>
                <div className="grid gap-2">
                  <Label
                    htmlFor="mdistrict"
                    className="text-[0.8125rem] font-medium text-muted-foreground"
                  >
                    District (optional)
                  </Label>
                  <Input
                    id="mdistrict"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    placeholder="e.g. Nashik"
                    className="h-10 border-input bg-card"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label
                  htmlFor="mmarket"
                  className="text-[0.8125rem] font-medium text-muted-foreground"
                >
                  Mandi / market (optional)
                </Label>
                <Input
                  id="mmarket"
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                  placeholder="e.g. Lasalgaon"
                  className="h-10 border-input bg-card"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => void load()}
                  disabled={loading || !crop}
                  className="h-11 flex-1 font-semibold"
                >
                  {loading ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Sprout className="mr-2 size-4" />
                  )}
                  {loading ? "Retrieving prices…" : "Fetch mandi prices"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void load({ refresh: true })}
                  disabled={loading || !crop}
                  className="h-11 px-3"
                  title="Bypass the cache and re-fetch"
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>

              <div className="rounded-xl bg-secondary/60 p-4 text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Source:</span>{" "}
                {marketEnabled
                  ? "official AGMARKNET / eNAM market data discovered and read with TinyFish."
                  : "market lookup needs TINYFISH_API_KEY on the server; no price can be shown without a live source."}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold">How prices are handled</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <p>
                Every price is normalised to INR per quintal and kept with the date and source it
                was read from.
              </p>
              <p>
                A price is never inferred: if no source states a usable figure, the dashboard shows
                “Data unavailable”.
              </p>
              <p>
                Market prices are shown for information only and never influence a rainfall payout.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-8 space-y-6">
          <Card className="border-border bg-card shadow-soft">
            <CardHeader className="border-b border-border pb-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-xl font-semibold">
                  {(result?.crop ?? crop) || "Mandi Price"}
                </CardTitle>
                {result && (
                  <div className="flex items-center gap-2">
                    {result.available ? (
                      <Badge
                        variant="outline"
                        className="border-sage/40 bg-sage/12 text-sage-strong"
                      >
                        Live
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-border bg-muted text-muted-foreground"
                      >
                        Data unavailable
                      </Badge>
                    )}
                    {result.cached && (
                      <Badge variant="outline" className="border-border text-muted-foreground">
                        Cached
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-8">
              {!result ? (
                <div className="flex flex-col items-center justify-center py-32 text-center text-muted-foreground">
                  <Sprout className="mb-4 size-16 text-sage/50" />
                  <p className="text-lg font-medium">
                    {error ? "Live data unavailable" : "Awaiting a lookup"}
                  </p>
                  <p className="mt-1 max-w-sm text-sm">
                    {error ?? "Choose a crop and fetch the latest mandi price."}
                  </p>
                </div>
              ) : !result.available || !latest ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="rounded-2xl border border-border bg-secondary/50 px-6 py-5">
                    <p className="text-lg font-semibold">Data unavailable</p>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                      {result.reason ?? "No usable price was found for this crop and location."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Modal price
                      </div>
                      <div className="font-display text-3xl font-semibold text-terracotta-strong">
                        {formatInrPerQuintal(latest.modalInr)}
                      </div>
                      <div className="text-[0.6875rem] text-muted-foreground">per quintal</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Minimum
                      </div>
                      <div className="font-display text-3xl font-semibold text-foreground">
                        {formatInrPerQuintal(latest.minInr)}
                      </div>
                      <div className="text-[0.6875rem] text-muted-foreground">per quintal</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Maximum
                      </div>
                      <div className="font-display text-3xl font-semibold text-foreground">
                        {formatInrPerQuintal(latest.maxInr)}
                      </div>
                      <div className="text-[0.6875rem] text-muted-foreground">per quintal</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Change
                      </div>
                      {change === null ? (
                        <div className="flex items-center gap-1.5 font-display text-3xl font-semibold text-muted-foreground">
                          <Minus className="size-5" /> —
                        </div>
                      ) : (
                        <div
                          className={
                            change > 0
                              ? "flex items-center gap-1.5 font-display text-3xl font-semibold text-destructive"
                              : change < 0
                                ? "flex items-center gap-1.5 font-display text-3xl font-semibold text-sage-strong"
                                : "flex items-center gap-1.5 font-display text-3xl font-semibold text-muted-foreground"
                          }
                        >
                          {change > 0 ? (
                            <TrendingUp className="size-5" />
                          ) : change < 0 ? (
                            <TrendingDown className="size-5" />
                          ) : (
                            <Minus className="size-5" />
                          )}
                          {change > 0 ? "+" : ""}
                          {change}%
                        </div>
                      )}
                      <div className="text-[0.6875rem] text-muted-foreground">
                        {result.previous?.modalInr !== null && result.previous !== null
                          ? `vs ${formatInrPerQuintal(result.previous.modalInr)} on ${result.previous.priceDate ?? "the previous day"}`
                          : "no previous price"}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2 rounded-xl bg-secondary/60 p-4 text-xs leading-relaxed text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <MapPin className="size-3.5 text-terracotta-strong" />
                      <span className="font-semibold text-foreground">
                        {[latest.market, latest.district, latest.state]
                          .filter(Boolean)
                          .join(", ") || "Location not stated by the source"}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-foreground">Market date:</span>{" "}
                      {latest.priceDate ?? "not stated"}
                      {" · "}
                      <span className="font-semibold text-foreground">Last updated:</span>{" "}
                      {latest.updatedAt ?? new Date(result.queriedAt).toLocaleString()}
                      {result.cached ? " · served from cache" : ""}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">Source:</span>
                      <a
                        href={latest.source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-terracotta-strong underline-offset-2 hover:underline"
                      >
                        {latest.source.name} <ExternalLink className="size-3" />
                      </a>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Modal price trend
                    </div>
                    <PriceTrendChart rows={result.history} />
                  </div>

                  {result.history.length > 1 && (
                    <div className="overflow-hidden rounded-2xl border border-border bg-secondary/40">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b border-border bg-secondary/60 text-left text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            <th className="px-6 py-4">Date</th>
                            <th className="px-6 py-4">Market</th>
                            <th className="px-6 py-4 text-right">Min</th>
                            <th className="px-6 py-4 text-right">Max</th>
                            <th className="px-6 py-4 text-right">Modal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {result.history.slice(0, 12).map((row, index) => (
                            <tr
                              key={`${row.priceDate ?? "row"}-${row.market ?? index}-${index}`}
                              className="transition-colors hover:bg-terracotta/8"
                            >
                              <td className="px-6 py-3 font-mono text-muted-foreground">
                                {row.priceDate ?? "—"}
                              </td>
                              <td className="px-6 py-3">{row.market ?? "—"}</td>
                              <td className="px-6 py-3 text-right font-mono">
                                {formatInrPerQuintal(row.minInr)}
                              </td>
                              <td className="px-6 py-3 text-right font-mono">
                                {formatInrPerQuintal(row.maxInr)}
                              </td>
                              <td className="px-6 py-3 text-right font-mono font-semibold text-foreground">
                                {formatInrPerQuintal(row.modalInr)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {result.sources.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Sources consulted
                      </div>
                      <ul className="space-y-1.5 text-xs text-muted-foreground">
                        {result.sources.map((source) => (
                          <li key={`${source.id}-${source.url}`}>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-terracotta-strong underline-offset-2 hover:underline"
                            >
                              {source.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-3 rounded-xl bg-lavender/10 p-4 text-[12px] leading-relaxed text-foreground ring-1 ring-lavender/25">
            <Info className="size-5 shrink-0 text-lavender-strong" />
            Market prices are provided for information only. They are never used as an input to a
            rainfall insurance payout, which settles solely on verified observed rainfall.
          </div>
        </div>
      </div>
    </div>
  );
}
