import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Calculator, CloudRain, Info, MapPin, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { OnchainPendingNotice, PageHeader } from "@/components/shared";
import { UpiPaymentPanel } from "@/components/upi-payment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/components/wallet-provider";
import { isOnchainEnabled } from "@/lib/chain";
import { purchasePolicyOnchain } from "@/lib/contract";
import { createDemoPolicy } from "@/lib/demo";
import { LOCATION_PRESETS, PERSONA_LABEL } from "@/lib/locations";
import { calculatePremium, coverageDays } from "@/lib/premium";
import { formatInr, type PolicyDraft, type UpiOrderView } from "@/lib/upi/types";

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
  const [isConfirming, setIsConfirming] = useState(false);
  const [isOnchainBusy, setIsOnchainBusy] = useState(false);

  const location = LOCATION_PRESETS[Number(locationIdx)] ?? LOCATION_PRESETS[0]!;
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

  const draft: PolicyDraft | null = useMemo(
    () =>
      breakdown
        ? {
          locationName: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
          startDate,
          endDate,
          thresholdMm,
          coverageEth: coverage,
          premiumEth: breakdown.premiumEth,
        }
        : null,
    [breakdown, location, startDate, endDate, thresholdMm, coverage],
  );

  /**
   * Fires once the server has verified the UPI payment (or recorded a clearly
   * labelled simulated settlement). Activating here — rather than on a browser
   * redirect — is what keeps the policy tied to a real payment. A wallet is not
   * required, so customers without MetaMask get the same cover.
   */
  function activateFromUpi(order: UpiOrderView) {
    const policy = createDemoPolicy({
      ...order.policyDraft,
      holderAddress: wallet.address,
      upiPayment: {
        orderId: order.orderId,
        paymentRef: order.paymentRef,
        amountInr: order.amountInr,
        amountEth: order.amountEth,
        verification: order.verification ?? "simulated",
        simulated: order.simulated,
        paidAt: order.paidAt ?? Date.now(),
      },
    });
    if (order.simulated) {
      toast.success(`Policy ${policy.id} activated — simulated UPI payment`, {
        description: "Demo mode: no real payment was made and no money moved.",
      });
    } else {
      toast.success(`Policy ${policy.id} activated — payment verified`, {
        description: `${formatInr(order.amountInr)} received and verified with the payment gateway.`,
      });
    }
  }

  /** Real purchase: MetaMask signs, the contract mints the policy on Sepolia. */
  async function buyOnchain() {
    if (!valid || !breakdown || !wallet.address) return;
    setIsOnchainBusy(true);
    try {
      const result = await purchasePolicyOnchain({
        locationName: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        startDate,
        endDate,
        thresholdMm,
        premiumEth: breakdown.premiumEth,
      });
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
        onchainPolicyId: result.policyId ? Number(result.policyId) : undefined,
        txHash: result.txHash,
      });
      toast.success(`Policy ${policy.id} purchased on-chain`, {
        description: `Transaction ${result.txHash.slice(0, 10)}… confirmed on Sepolia.`,
        action: { label: "View", onClick: () => window.open(result.explorerUrl, "_blank") },
      });
      navigate({ to: "/policies" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setIsOnchainBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-20">
      <div className="mx-auto max-w-4xl text-center">
        <Badge variant="outline" className="border-lavender/40 bg-lavender/12 text-lavender-strong">Step 1: Configure</Badge>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Protect your livelihood</h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted-foreground">
          Define your parameters. Our engine calculates a fair, transparent premium based on local weather data.
        </p>
      </div>

      <div className="mt-14 grid gap-8 lg:grid-cols-12">
        {/* Form */}
        <div className="lg:col-span-7">
          <Card className="border-border bg-card shadow-soft">
            <CardHeader className="border-b border-border pb-6">
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <CloudRain className="size-5 text-rain" /> Coverage Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-8 pt-8">
              <div className="grid gap-3">
                <Label htmlFor="location" className="text-[0.8125rem] font-medium text-muted-foreground">Region of Interest</Label>
                <select
                  id="location"
                  value={locationIdx}
                  onChange={(e) => setLocationIdx(e.target.value)}
                  className="h-11 rounded-lg border border-input bg-card px-4 text-[15px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  {LOCATION_PRESETS.map((l, i) => (
                    <option key={l.name} value={i} className="bg-card">
                      {l.name} — {PERSONA_LABEL[l.persona]}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
                  <MapPin className="size-3" />
                  {location.latitude}°N, {location.longitude}°E · {location.region}
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="grid gap-3">
                  <Label htmlFor="start" className="text-[0.8125rem] font-medium text-muted-foreground">Start Date</Label>
                  <Input
                    id="start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-11 border-input bg-card focus-visible:ring-2 focus-visible:ring-ring/30"
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="end" className="text-[0.8125rem] font-medium text-muted-foreground">End Date</Label>
                  <Input
                    id="end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-11 border-input bg-card focus-visible:ring-2 focus-visible:ring-ring/30"
                  />
                </div>
              </div>

              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="threshold" className="text-[0.8125rem] font-medium text-muted-foreground">
                    Rainfall Threshold
                  </Label>
                  <span className="font-display text-base font-semibold text-terracotta-strong">{thresholdMm} mm</span>
                </div>
                <input
                  id="threshold"
                  type="range"
                  min={5}
                  max={200}
                  step={5}
                  value={thresholdMm}
                  onChange={(e) => setThresholdMm(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-terracotta"
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The trigger point: if total rainfall over the period stays <span className="font-semibold text-foreground underline decoration-terracotta/40">below</span> this value, the policy pays out.
                </p>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="coverage" className="text-[0.8125rem] font-medium text-muted-foreground">Desired Payout (ETH)</Label>
                <div className="relative">
                  <Input
                    id="coverage"
                    type="number"
                    min={0.01}
                    max={2}
                    step={0.01}
                    value={coverageEth}
                    onChange={(e) => setCoverageEth(e.target.value)}
                    className="h-11 border-input bg-card pl-4 pr-12 font-mono focus-visible:ring-2 focus-visible:ring-ring/30"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">ETH</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Enter an amount between 0.01 and 2.0 ETH.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Breakdown & CTA */}
        <div className="lg:col-span-5">
          <div className="sticky top-24 space-y-6">
            <Card className="border-terracotta/25 bg-terracotta/8">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <Calculator className="size-5 text-terracotta" /> Premium Quotation
                </CardTitle>
              </CardHeader>
              <CardContent>
                {breakdown ? (
                  <div className="space-y-4">
                    <div className="grid gap-2 text-[13px]">
                      <Row label="Target Payout" value={`${breakdown.coverageEth} ETH`} />
                      <Row label="Duration" value={`${breakdown.days} days`} />
                      <Row label="Trigger Threshold" value={`${breakdown.thresholdMm} mm`} />
                      <div className="my-2 h-px bg-border" />
                      <Row label="Base Probability Rate" value={`${(breakdown.baseRate * 100).toFixed(1)}%`} />
                      <Row label="Duration Adjustment" value={`x${breakdown.dayFactor}`} />
                      <Row label="Risk Coefficient" value={`x${breakdown.thresholdFactor}`} />
                    </div>

                    <div className="mt-6 flex flex-col items-center justify-between gap-2 rounded-xl bg-terracotta/12 p-5 ring-1 ring-terracotta/25">
                      <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-terracotta-strong/80">Premium Due</span>
                      <span className="font-display text-3xl font-semibold text-terracotta-strong">
                        {breakdown.premiumEth} <span className="text-lg">ETH</span>
                      </span>
                    </div>

                    <div className="flex items-start gap-2 rounded-lg bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
                      <Info className="mt-0.5 size-3.5 shrink-0 text-terracotta" />
                      Calculated as: Coverage × Base Rate × Duration Adjustment × Risk Coefficient.
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-secondary">
                      <Calculator className="size-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Configure your policy details to see a transparent premium quote.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <UpiPaymentPanel draft={draft} onVerified={activateFromUpi} />

            <Card className="border-border bg-card">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Wallet className="size-4 text-lavender-strong" /> On-chain demo (Sepolia testnet)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Optional, for judges and technical reviewers. This mints the same policy with a real transaction on
                  the Sepolia testnet using test ETH. It is a separate track from your UPI premium — no UPI payment is
                  made here, and test ETH has no monetary value.
                </p>
                <Button
                  className="h-12 w-full text-sm font-semibold"
                  variant="secondary"
                  disabled={!isOnchainEnabled() || !wallet.address || !wallet.onSepolia || isOnchainBusy}
                  onClick={buyOnchain}
                  title={
                    !isOnchainEnabled()
                      ? "Requires the SkyCover insurance contract deployed on Sepolia"
                      : !wallet.address
                        ? "Connect a wallet to use this track"
                        : !wallet.onSepolia
                          ? "Switch to Sepolia network"
                          : undefined
                  }
                >
                  {isOnchainBusy ? "Confirm in MetaMask…" : "Transact with MetaMask"}
                </Button>
                {wallet.address === null && isOnchainEnabled() && (
                  <p className="text-center text-xs leading-relaxed text-muted-foreground">
                    Connect a wallet from the header to enable this track. Not needed for UPI.
                  </p>
                )}
                <OnchainPendingNotice>
                  the SkyCover smart contracts are not deployed to Sepolia yet, so the on-chain track is unavailable.
                  UPI payments above are unaffected.
                </OnchainPendingNotice>
              </CardContent>
            </Card>
          </div>
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
