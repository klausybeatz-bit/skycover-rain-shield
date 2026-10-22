import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CloudRain,
  Droplets,
  Landmark,
  MapPin,
  ShieldCheck,
  TrendingDown,
  Waves,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import heroImage from "@/assets/hero-rain.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "SkyCover — Rain Insurance That Pays Automatically",
      },
      {
        name: "description",
        content:
          "SkyCover protects farmers, homestay owners and tour guides from rain-loss with parametric, blockchain-settled insurance on the Sepolia testnet.",
      },
      { property: "og:title", content: "SkyCover — Rain Insurance That Pays Automatically" },
      {
        property: "og:description",
        content:
          "Pick a rainfall threshold, pay a small premium, and get paid automatically if the rains fall short. Powered by real weather data and smart contracts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const PERSONAS = [
  {
    icon: Waves,
    title: "Farmers",
    body: "A dry spell during sowing or flowering ruins a whole season. SkyCover pays while the crop is still in the ground — no claim forms, no field visits, no waiting months.",
  },
  {
    icon: MapPin,
    title: "Homestay owners",
    body: "Weeks of relentless rain empty your rooms and cancel bookings. Cover your peak season: if rainfall soaks past your threshold, the payout offsets the lost revenue.",
  },
  {
    icon: CloudRain,
    title: "Tour guides",
    body: "Trekking, rafting and sightseeing shut down in bad weather. Insure your busiest weeks against washout conditions and keep your income predictable.",
  },
] as const;

const STEPS = [
  {
    icon: MapPin,
    title: "1. Choose your cover",
    body: "Pick your location, coverage dates, a rainfall threshold (mm) and the payout amount you need.",
  },
  {
    icon: Landmark,
    title: "2. Pay the premium",
    body: "A small, transparent premium — calculated from coverage size, duration and threshold — goes into the liquidity pool smart contract.",
  },
  {
    icon: Droplets,
    title: "3. Oracle records rainfall",
    body: "A authorized weather oracle reports total rainfall over your window from the Open-Meteo historical dataset. You can verify every reading.",
  },
  {
    icon: ShieldCheck,
    title: "4. Automatic payout",
    body: "If rainfall lands below your threshold, the contract releases the payout to your wallet — automatically, without filing any claim.",
  },
] as const;

function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <img
          src={heroImage}
          alt="Monsoon rain clouds over terraced farmland"
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0 hero-gradient opacity-95" />
        <div className="relative mx-auto max-w-6xl px-4 py-24 sm:py-32">
          <Badge variant="outline" className="border-primary/40 text-primary">
            Parametric rain insurance · Sepolia testnet prototype
          </Badge>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-bold leading-tight sm:text-6xl">
            When the rains fail, <span className="text-gradient-sky">the payout doesn't.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            SkyCover is parametric rain insurance settled on-chain. You set a rainfall threshold for
            your location and season — if the recorded rainfall falls below it, a smart contract pays
            you automatically. No claim forms, no adjusters, no delays.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="text-base">
              <Link to="/buy">
                Get Covered <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary" className="text-base">
              <Link to="/demo">Run the 2-minute demo</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* The problem */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-2xl font-semibold sm:text-3xl">Rain risk is income risk</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Traditional crop and travel insurance is slow, disputed and often out of reach for small
          operators. The people who depend on the weather the most get the least protection.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {PERSONAS.map((p) => (
            <Card key={p.title} className="card-glow">
              <CardHeader>
                <p.icon className="size-6 text-accent" />
                <CardTitle className="mt-2 text-lg">{p.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{p.body}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-border/60 bg-card/40 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="font-display text-2xl font-semibold sm:text-3xl">
            How automated rain insurance works
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <Card key={s.title} className="border-border/60">
                <CardHeader>
                  <s.icon className="size-5 text-primary" />
                  <CardTitle className="mt-2 text-base">{s.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{s.body}</CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: "Objective triggers",
              body: "Payouts are decided by measured rainfall, not by an inspector's opinion. The threshold is written into the policy before you pay.",
            },
            {
              icon: TrendingDown,
              title: "Payouts in days, not months",
              body: "The moment the oracle reports rainfall below threshold, the smart contract releases funds to your wallet — no paperwork at all.",
            },
            {
              icon: Landmark,
              title: "Transparent reserve",
              body: "Premiums sit in a public liquidity pool on the blockchain. Anyone can verify the pool can pay every active policy.",
            },
          ].map((b) => (
            <div key={b.title} className="rounded-xl border border-border/60 p-6">
              <b.icon className="size-6 text-accent" />
              <h3 className="mt-3 font-display text-lg font-semibold">{b.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{b.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-primary/30 bg-primary/10 p-8 text-center">
          <h2 className="font-display text-2xl font-semibold">Ready to cover your season?</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Build a policy in under a minute — choose your location, dates, rainfall threshold and
            coverage amount, and see the premium calculated transparently.
          </p>
          <Button asChild size="lg" className="mt-6 text-base">
            <Link to="/buy">
              Get Covered <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
