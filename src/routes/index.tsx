import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  CloudRain,
  Compass,
  Droplets,
  FileCode2,
  Gauge,
  GraduationCap,
  Home as HomeIcon,
  Info,
  MapPin,
  ScrollText,
  ShieldCheck,
  Sprout,
  Wallet,
} from "lucide-react";
import { useId, useState, type CSSProperties } from "react";

import audienceFarmer from "@/assets/audience-farmer.jpg";
import audienceHomestay from "@/assets/audience-homestay.jpg";
import audienceTourguide from "@/assets/audience-tourguide.jpg";
import heroMonsoon from "@/assets/hero-monsoon.jpg";
import { CountUp, Reveal, useDrawOnce, useInView, useParallax } from "@/components/motion";
import { SimulatedBadge } from "@/components/shared";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@/components/wallet-provider";
import { CONTRACTS, isOnchainEnabled, SEPOLIA_CHAIN_NAME } from "@/lib/chain";
import { LOCATION_PRESETS } from "@/lib/locations";
import { BASE_RATE_PER_30_DAYS, calculatePremium } from "@/lib/premium";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SkyCover — Parametric Rain Insurance on Sepolia" },
      {
        name: "description",
        content:
          "SkyCover is parametric rainfall cover for farmers, homestay owners and tour guides. Pick a location and a rainfall trigger, pay a premium, and the policy settles from a measured reading.",
      },
      { property: "og:title", content: "SkyCover — Parametric Rain Insurance" },
      {
        property: "og:description",
        content:
          "When the rain changes everything, you're covered. Rainfall-triggered policies settled by smart contract on the Sepolia testnet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

/* ------------------------------------------------------------------ *
 * Content
 * ------------------------------------------------------------------ */

/** Deterministic drop pattern so server and client markup match exactly. */
const RAIN_DROPS = [
  { left: 4, height: 60, delay: 0, duration: 2300 },
  { left: 11, height: 96, delay: 420, duration: 2650 },
  { left: 18, height: 48, delay: 180, duration: 2100 },
  { left: 25, height: 84, delay: 900, duration: 2450 },
  { left: 32, height: 68, delay: 640, duration: 2250 },
  { left: 39, height: 40, delay: 1240, duration: 2000 },
  { left: 46, height: 90, delay: 300, duration: 2700 },
  { left: 53, height: 54, delay: 1080, duration: 2150 },
  { left: 60, height: 80, delay: 760, duration: 2500 },
  { left: 67, height: 46, delay: 1500, duration: 2050 },
  { left: 74, height: 88, delay: 220, duration: 2600 },
  { left: 81, height: 64, delay: 1160, duration: 2300 },
  { left: 88, height: 42, delay: 540, duration: 1950 },
  { left: 95, height: 76, delay: 1380, duration: 2400 },
];

const PERSONAS = [
  {
    icon: Sprout,
    image: audienceFarmer,
    imageAlt: "Hands planting young paddy shoots in a flooded field during monsoon rain.",
    title: "Farmers",
    kicker: "Sowing to harvest",
    body: "A dry spell during sowing or flowering can take a whole season with it. SkyCover settles from a rainfall reading while the crop is still in the ground, not after a harvest-time inspection.",
    chip: "bg-card text-terracotta-strong ring-terracotta/25",
  },
  {
    icon: HomeIcon,
    image: audienceHomestay,
    imageAlt: "A hillside homestay cottage among misty tea plantations in monsoon rain.",
    title: "Homestay owners",
    kicker: "Peak season nights",
    body: "Weeks of relentless rain empty rooms and cancel bookings. Cover your busiest weeks against a rainfall trigger and the payout offsets the revenue the weather took.",
    chip: "bg-card text-lavender-strong ring-lavender-strong/25",
  },
  {
    icon: Compass,
    image: audienceTourguide,
    imageAlt: "A trekking guide leading a trail through misty rainforest during monsoon.",
    title: "Tour guides",
    kicker: "Trek and raft days",
    body: "Trekking, rafting and sightseeing shut down in washout conditions. Cover your operating weeks and keep income predictable when the forecast turns.",
    chip: "bg-card text-rain-strong ring-rain-strong/25",
  },
] as const;

const STEPS = [
  {
    icon: MapPin,
    title: "Choose coverage",
    body: "Pick a covered location, a coverage window and the rainfall trigger in millimetres that reflects the loss you want to insure.",
  },
  {
    icon: Wallet,
    title: "Pay premium",
    body: "The premium follows one published formula from your own inputs. Pay it in demo mode, or sign a real testnet transaction with MetaMask.",
  },
  {
    icon: CloudRain,
    title: "Verify rainfall",
    body: "The policy watches a single number: total rainfall recorded at your coordinates over the window, from the Open-Meteo archive.",
  },
  {
    icon: Banknote,
    title: "Receive eligible payout",
    body: "If the verified total lands below your trigger, the policy becomes payout-eligible and can be claimed — capped by pool liquidity.",
  },
] as const;

const TRUST_PILLARS = [
  {
    icon: Wallet,
    title: "Wallet connectivity",
    body: "MetaMask connects directly in your browser. SkyCover never sees a private key and never asks you to type a seed phrase.",
  },
  {
    icon: FileCode2,
    title: "Smart contracts",
    body: "Policies, premiums and payouts are handled by the SkyCoverInsurance contract on Sepolia. Every state change is a signed transaction you approve yourself.",
  },
  {
    icon: Droplets,
    title: "Weather data",
    body: "Rainfall readings come from the Open-Meteo historical archive, with the source, coordinates and timestamp attached to each report.",
  },
  {
    icon: ScrollText,
    title: "Policy rules",
    body: "The payout rule is a single comparison: total rainfall below the trigger means payout-eligible. No adjusters, no claim forms, no discretion.",
  },
] as const;

const POLICY_FAQ = [
  {
    q: "What exactly triggers a payout?",
    a: "One condition: the total rainfall recorded at your covered location over the coverage window must be strictly below the trigger you chose. Equal to or above the trigger means the covered activity was not rain-starved, so no payout is due.",
  },
  {
    q: "How is the premium calculated?",
    a: "Premium = coverage × 6% per 30-day period × (1 + trigger ÷ 200). A longer window costs proportionally more; a higher trigger is easier to breach, so it costs more too. The buy page shows the full breakdown before you sign anything.",
  },
  {
    q: "What if the pool cannot cover the payout?",
    a: "A payout is capped by the liquidity currently available in the pool. Pool deposits come from premiums and from liquidity providers, so a payout is never assumed to be guaranteed.",
  },
  {
    q: "Is this real insurance?",
    a: "No. SkyCover is a technical prototype running on the Sepolia testnet. No real money, regulated insurance product or licensed underwriter is involved, and every simulated value on this site is labelled as such.",
  },
] as const;

/** Illustrative example policy — figures come from the real premium engine. */
const EXAMPLE_COVERAGE_ETH = 0.25;
const EXAMPLE_TRIGGER_MM = 60;
const EXAMPLE_DAYS = 60;
const EXAMPLE_RAINFALL_MM = 41.2;
const EXAMPLE_PREMIUM = calculatePremium(EXAMPLE_COVERAGE_ETH, EXAMPLE_TRIGGER_MM, EXAMPLE_DAYS);
const EXAMPLE_PREMIUM_ETH = EXAMPLE_PREMIUM.premiumEth;
const EXAMPLE_LOCATION = LOCATION_PRESETS[3] as (typeof LOCATION_PRESETS)[number];

/* ------------------------------------------------------------------ *
 * Landing page
 * ------------------------------------------------------------------ */

function Home() {
  return (
    <div className="bg-background">
      <Hero />
      <IntegrationStrip />
      <AudienceSection />
      <HowItWorksSection />
      <EditorialStatement />
      <RainfallDemoSection />
      <CoveragePremiumSection />
      <TrustSection />
      <FinalCtaSection />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shared bits
 * ------------------------------------------------------------------ */

/** Small uppercase section label — used once per section, never everywhere. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[0.6875rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
      {children}
    </span>
  );
}

/** CSS-only rainfall used over the hero photograph. */
function RainOverlay({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {RAIN_DROPS.map((drop) => (
        <span
          key={drop.left}
          className="sc-rain-drop absolute w-px rounded-full bg-white/35"
          style={{
            left: `${drop.left}%`,
            height: `${drop.height}px`,
            animationDelay: `${drop.delay}ms`,
            animationDuration: `${drop.duration}ms`,
          }}
        />
      ))}
    </div>
  );
}

/* Section A — Hero -------------------------------------------------- */

function ExamplePolicyCard() {
  return (
    <div className="sc-bob w-full rounded-2xl border border-border bg-card p-4 shadow-lift">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-lavender/40 text-lavender-strong">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <div className="font-display text-[0.8125rem] leading-tight font-semibold">
              Policy SC-0001
            </div>
            <div className="text-[0.625rem] text-muted-foreground">Illustrative example</div>
          </div>
        </div>
        <Badge variant="outline" className="border-lavender bg-lavender/30 text-lavender-strong">
          Active
        </Badge>
      </div>

      <div className="mt-4 space-y-2.5 text-[0.75rem]">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="size-3.5" /> Location
          </span>
          <span className="font-medium">{EXAMPLE_LOCATION.name}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Gauge className="size-3.5" /> Trigger
          </span>
          <span className="font-medium tabular-nums text-rain-strong">
            below {EXAMPLE_TRIGGER_MM} mm
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Banknote className="size-3.5" /> Payout
          </span>
          <span className="font-medium tabular-nums">{EXAMPLE_COVERAGE_ETH} ETH</span>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[0.625rem] text-muted-foreground">
          <span>Recorded {EXAMPLE_RAINFALL_MM} mm</span>
          <span>Trigger {EXAMPLE_TRIGGER_MM} mm</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-rain-strong"
            style={{ width: `${Math.round((EXAMPLE_RAINFALL_MM / EXAMPLE_TRIGGER_MM) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const parallax = useParallax<HTMLDivElement>(14);

  return (
    <section className="hero-wash relative overflow-hidden border-b border-border">
      <div className="mx-auto max-w-7xl px-4 pt-12 pb-20 sm:px-6 lg:pt-16 lg:pb-28">
        <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-6">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-forest/20 bg-forest-tint px-3.5 py-1.5 text-[0.6875rem] font-semibold tracking-[0.16em] text-forest uppercase">
                <span className="size-1.5 rounded-full bg-terracotta" aria-hidden />
                Weather-based protection
              </span>
            </Reveal>

            <Reveal delay={90}>
              <h1 className="mt-7 font-display text-[2.75rem] leading-[1.04] font-semibold tracking-[-0.035em] text-balance sm:text-[3.5rem] lg:text-[4rem] xl:text-[4.5rem]">
                When the Rain Changes Everything,{" "}
                <span className="font-serif font-normal italic text-terracotta-strong">
                  You&rsquo;re Covered.
                </span>
              </h1>
            </Reveal>

            <Reveal delay={180}>
              <p className="mt-7 max-w-xl text-[1.0625rem] leading-relaxed text-muted-foreground sm:text-[1.125rem]">
                SkyCover is rainfall cover that pays on a measurement, not a claim form. Choose a
                location, set the rainfall trigger that mirrors your loss, and the policy settles
                from a verified reading for the season you cannot control.
              </p>
            </Reveal>

            <Reveal delay={260}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="group">
                  <Link to="/buy">
                    Explore coverage
                    <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="#how-it-works">How it works</a>
                </Button>
              </div>
            </Reveal>

            <Reveal delay={340}>
              <dl className="mt-10 grid max-w-lg grid-cols-3 gap-x-6 gap-y-4 border-t border-border pt-7">
                {[
                  { k: "Settlement input", v: "Rainfall (mm)" },
                  { k: "Payout rule", v: "One comparison" },
                  { k: "Network", v: SEPOLIA_CHAIN_NAME },
                ].map((item) => (
                  <div key={item.k}>
                    <dt className="text-[0.6875rem] text-muted-foreground">{item.k}</dt>
                    <dd className="mt-1 font-display text-[0.9375rem] font-semibold">{item.v}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>

          <Reveal delay={200} className="lg:col-span-6">
            <div className="relative mx-auto w-full max-w-[26rem] lg:max-w-[30rem]">
              <div className="relative overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-lift">
                <div ref={parallax.ref} className="relative aspect-[4/5] w-full">
                  <img
                    src={heroMonsoon}
                    alt="A farmer standing in a flooded rice paddy during heavy monsoon rain."
                    className="size-full object-cover will-change-transform"
                    style={{ transform: `translate3d(0, ${parallax.offset}px, 0) scale(1.08)` }}
                  />
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-t from-forest/80 via-forest/15 to-transparent"
                  />
                  <RainOverlay />

                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[0.75rem] font-medium text-[#FAF8F3]">
                        <span className="size-2 rounded-full bg-terracotta" aria-hidden />
                        Rainfall monitor
                      </div>
                      <SimulatedBadge />
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {[
                        { label: "Season total", value: `${EXAMPLE_RAINFALL_MM}` },
                        { label: "Trigger", value: `${EXAMPLE_TRIGGER_MM}` },
                        { label: "Premium", value: `${EXAMPLE_PREMIUM_ETH}` },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 backdrop-blur-[2px]"
                        >
                          <div className="text-[0.5625rem] tracking-[0.1em] text-[#FAF8F3]/70 uppercase">
                            {stat.label}
                          </div>
                          <div className="mt-0.5 font-display text-[0.9375rem] font-semibold tabular-nums text-[#FAF8F3]">
                            {stat.label === "Premium" ? (
                              <span>{stat.value} ETH</span>
                            ) : (
                              <CountUp value={Number(stat.value)} decimals={1} suffix=" mm" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative z-10 mx-auto -mt-8 w-[min(100%,20rem)] lg:absolute lg:-bottom-9 lg:-left-8 lg:mt-0 lg:mx-0 lg:w-[19rem]">
                <ExamplePolicyCard />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* Integration strip ------------------------------------------------ */

function IntegrationStrip() {
  const items = [
    { icon: ShieldCheck, label: `${SEPOLIA_CHAIN_NAME} testnet` },
    { icon: CloudRain, label: "Open-Meteo rainfall archive" },
    { icon: FileCode2, label: "Solidity settlement engine" },
  ];

  return (
    <section className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-4 py-6 sm:px-6 lg:justify-between">
        {items.map((item, i) => (
          <Reveal key={item.label} delay={i * 80}>
            <div className="flex items-center gap-2.5 text-[0.8125rem] text-muted-foreground">
              <item.icon className="size-4 text-forest" />
              {item.label}
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* Section B — Audience --------------------------------------------- */

function AudienceSection() {
  return (
    <section id="who-its-for" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
      <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <Reveal className="lg:col-span-7">
          <Eyebrow>Who it&rsquo;s for</Eyebrow>
          <h2 className="mt-5 max-w-2xl font-display text-[2rem] leading-[1.1] font-semibold tracking-tight sm:text-[2.5rem]">
            Three livelihoods that read the sky before they read the calendar.
          </h2>
        </Reveal>
        <Reveal delay={100} className="lg:col-span-5">
          <p className="text-[1.0625rem] leading-relaxed text-muted-foreground">
            Rain-dependent work loses income in days, while conventional claims take months of
            inspection. SkyCover replaces the adjustment with a measurement.
          </p>
        </Reveal>
      </div>

      <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {PERSONAS.map((persona, i) => (
          <Reveal key={persona.title} delay={i * 110}>
            <Card className="group h-full overflow-hidden transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-lift">
              <div className="relative h-48 overflow-hidden">
                <img
                  src={persona.image}
                  alt={persona.imageAlt}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.05]"
                />
                <span
                  className={`absolute bottom-3 left-3 flex size-9 items-center justify-center rounded-xl shadow-soft ring-1 ${persona.chip}`}
                >
                  <persona.icon className="size-[1.125rem]" />
                </span>
              </div>
              <CardHeader className="gap-2 pb-3">
                <span className="text-[0.6875rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                  {persona.kicker}
                </span>
                <CardTitle className="text-[1.25rem]">{persona.title}</CardTitle>
              </CardHeader>
              <CardContent className="pb-6">
                <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
                  {persona.body}
                </p>
                <Link
                  to="/buy"
                  className="mt-5 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-terracotta-strong underline decoration-terracotta/35 underline-offset-4 transition-colors duration-200 hover:decoration-terracotta-strong"
                >
                  Build a policy
                  <ArrowRight className="size-3.5" />
                </Link>
              </CardContent>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* Section C — How it works ----------------------------------------- */

function StepConnector() {
  const { ref, state } = useInView<HTMLDivElement>({ threshold: 0.35 });

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute top-6 hidden lg:block">
      <div className="absolute inset-x-[12.5%] h-px bg-border" />
      <div
        className="absolute inset-x-[12.5%] h-px origin-left bg-gradient-to-r from-terracotta via-lavender-strong to-forest transition-transform duration-[1600ms] ease-out"
        style={{ transform: state === "hidden" ? "scaleX(0)" : "scaleX(1)" }}
      />
    </div>
  );
}

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-y border-border bg-card">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <Reveal className="lg:col-span-7">
            <Eyebrow>How SkyCover works</Eyebrow>
            <h2 className="mt-5 max-w-xl font-display text-[2rem] leading-[1.1] font-semibold tracking-tight sm:text-[2.5rem]">
              Four steps from cover to settlement.
            </h2>
          </Reveal>
          <Reveal delay={100} className="lg:col-span-5">
            <p className="text-[1.0625rem] leading-relaxed text-muted-foreground">
              No claim forms, no loss adjusters. One measured condition decides the outcome, and you
              can inspect every input before you commit.
            </p>
          </Reveal>
        </div>

        <div className="relative mt-16">
          <StepConnector />
          <ol className="relative grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 150} className="lg:px-3">
                <li className="flex flex-col items-start">
                  <span className="relative z-10 flex size-12 items-center justify-center rounded-full border border-border bg-background text-terracotta shadow-soft">
                    <step.icon className="size-5" />
                  </span>
                  <span className="mt-5 text-[0.6875rem] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                    Step {i + 1}
                  </span>
                  <h3 className="mt-2 font-display text-[1.125rem] leading-snug font-semibold tracking-tight">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* Section D — Oversized editorial statement ------------------------ */

function EditorialStatement() {
  return (
    <section className="forest-band">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-32">
        <Reveal>
          <span className="text-[0.6875rem] font-semibold tracking-[0.18em] text-[#B9CCB5] uppercase">
            Why parametric
          </span>
        </Reveal>
        <Reveal delay={90}>
          <p className="mt-8 max-w-5xl font-display text-[2.25rem] leading-[1.06] font-semibold tracking-[-0.035em] text-balance text-[#FAF8F3] sm:text-[3rem] lg:text-[4rem]">
            Rain arrives in hours.
            <br />
            <span className="font-serif font-normal italic text-[#E9A18B]">
              Settlement shouldn&rsquo;t take months.
            </span>
          </p>
        </Reveal>
        <Reveal delay={180}>
          <div className="mt-12 grid gap-10 border-t border-white/15 pt-10 lg:grid-cols-12">
            <p className="text-[1.0625rem] leading-relaxed text-[#FAF8F3]/75 lg:col-span-5">
              A parametric policy does not ask what a loss was worth. It asks whether a threshold was
              crossed. That single fact is what removes the adjuster, the paperwork and the wait.
            </p>
            <dl className="grid gap-8 sm:grid-cols-3 lg:col-span-7">
              {[
                { k: "Trigger", v: "Rainfall threshold" },
                { k: "Evidence", v: "Archive reading" },
                { k: "Discretion", v: "None" },
              ].map((item) => (
                <div key={item.k}>
                  <dt className="text-[0.6875rem] tracking-[0.16em] text-[#B9CCB5] uppercase">
                    {item.k}
                  </dt>
                  <dd className="mt-2 font-display text-[1.125rem] font-semibold text-[#FAF8F3]">
                    {item.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* Section E — Interactive rainfall demonstration -------------------- */

const CURVE_DAYS = 30;

const CURVE_WEIGHTS = (() => {
  const weights: number[] = [];
  let seed = 1234;
  for (let i = 0; i < CURVE_DAYS; i++) {
    seed = (seed * 137 + 71) % 9973;
    weights.push(0.55 + (seed % 100) / 100);
  }
  return weights;
})();

const CURVE_WEIGHT_SUM = CURVE_WEIGHTS.reduce((sum, w) => sum + w, 0);

/** Cumulative rainfall curve whose final value is exactly `total`. */
function cumulativeCurve(total: number): number[] {
  let acc = 0;
  return CURVE_WEIGHTS.map((w) => {
    acc += (w / CURVE_WEIGHT_SUM) * total;
    return acc;
  });
}

const CHART = { width: 640, height: 220, top: 18, right: 18, bottom: 30, left: 18 };

function chartPoints(total: number, yMax: number) {
  const innerW = CHART.width - CHART.left - CHART.right;
  const innerH = CHART.height - CHART.top - CHART.bottom;
  return cumulativeCurve(total).map((value, i) => {
    const x = CHART.left + (i / (CURVE_DAYS - 1)) * innerW;
    const y = CHART.top + innerH - Math.min(1, value / yMax) * innerH;
    return [x, y] as const;
  });
}

function RainfallChart({ rainfallMm, triggerMm }: { rainfallMm: number; triggerMm: number }) {
  const { ref, drawn } = useDrawOnce<SVGSVGElement>();
  const gradientId = useId();

  const yMax = Math.max(rainfallMm, triggerMm, 10) * 1.35;
  const innerW = CHART.width - CHART.left - CHART.right;
  const innerH = CHART.height - CHART.top - CHART.bottom;
  const points = chartPoints(rainfallMm, yMax);
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${(CHART.left + innerW).toFixed(1)} ${(CHART.top + innerH).toFixed(1)} L${CHART.left.toFixed(1)} ${(CHART.top + innerH).toFixed(1)} Z`;
  const triggerY = CHART.top + innerH - Math.min(1, triggerMm / yMax) * innerH;
  const [lastX, lastY] = points[points.length - 1]!;

  const drawStyle = { "--sc-path-length": "1" } as CSSProperties;

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      role="img"
      aria-label={`Cumulative rainfall of ${rainfallMm} millimetres against a ${triggerMm} millimetre trigger.`}
      className="h-auto w-full"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--rain)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--rain)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0, 0.5, 1].map((ratio) => (
        <line
          key={ratio}
          x1={CHART.left}
          x2={CHART.left + innerW}
          y1={CHART.top + innerH * ratio}
          y2={CHART.top + innerH * ratio}
          stroke="var(--border)"
          strokeWidth="1"
        />
      ))}

      <path
        d={area}
        fill={`url(#${gradientId})`}
        style={{ opacity: drawn ? 1 : 0.35, transition: "opacity 700ms ease-out" }}
      />

      <line
        x1={CHART.left}
        x2={CHART.left + innerW}
        y1={triggerY}
        y2={triggerY}
        stroke="var(--amber)"
        strokeWidth="1.5"
        strokeDasharray="6 5"
      />
      <text
        x={CHART.left}
        y={triggerY - 7}
        className="fill-amber-strong text-[10px]"
        style={{ fontSize: 11, fontWeight: 500 }}
      >
        Trigger · {triggerMm} mm
      </text>

      <path
        d={line}
        fill="none"
        stroke="var(--rain-strong)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className="sc-draw-path"
        data-drawn={drawn}
        style={drawStyle}
      />

      <circle cx={lastX} cy={lastY} r="4.5" fill="var(--rain-strong)" />

      <text
        x={CHART.left}
        y={CHART.height - 8}
        style={{ fontSize: 11 }}
        className="fill-muted-foreground"
      >
        Day 1
      </text>
      <text
        x={CHART.left + innerW}
        y={CHART.height - 8}
        textAnchor="end"
        style={{ fontSize: 11 }}
        className="fill-muted-foreground"
      >
        Day {CURVE_DAYS}
      </text>
    </svg>
  );
}

function RainfallDemoSection() {
  const [rainfall, setRainfall] = useState(EXAMPLE_RAINFALL_MM);
  const [trigger, setTrigger] = useState(EXAMPLE_TRIGGER_MM);
  const satisfied = rainfall < trigger;

  return (
    <section id="demo" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-14">
        <Reveal className="lg:col-span-5">
          <Eyebrow>Rainfall demonstration</Eyebrow>
          <h2 className="mt-5 font-display text-[2rem] leading-[1.1] font-semibold tracking-tight sm:text-[2.5rem]">
            Move the rainfall. Watch the condition resolve.
          </h2>
          <p className="mt-5 text-[1.0625rem] leading-relaxed text-muted-foreground">
            The payout rule is one comparison. Drag the season total and the trigger to see how a
            reported reading turns into an eligible or ineligible policy.
          </p>

          <div className="mt-9 space-y-8">
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="demo-rainfall" className="text-[0.875rem] font-medium">
                  Recorded season total
                </label>
                <span className="font-display text-lg font-semibold tabular-nums text-rain-strong">
                  {rainfall.toFixed(1)} mm
                </span>
              </div>
              <input
                id="demo-rainfall"
                type="range"
                min={0}
                max={140}
                step={0.1}
                value={rainfall}
                onChange={(e) => setRainfall(Number(e.target.value))}
                className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-rain"
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="demo-trigger" className="text-[0.875rem] font-medium">
                  Policy trigger
                </label>
                <span className="font-display text-lg font-semibold tabular-nums text-amber-strong">
                  {trigger} mm
                </span>
              </div>
              <input
                id="demo-trigger"
                type="range"
                min={10}
                max={140}
                step={1}
                value={trigger}
                onChange={(e) => setTrigger(Number(e.target.value))}
                className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-amber"
              />
            </div>
          </div>

          <div
            role="status"
            className={`mt-9 flex items-start gap-3 rounded-2xl border px-4 py-4 text-[0.875rem] leading-relaxed ${satisfied
              ? "border-sage bg-sage/30 text-sage-strong"
              : "border-amber bg-amber/25 text-amber-strong"
              }`}
          >
            {satisfied ? (
              <BadgeCheck className="mt-0.5 size-4 shrink-0" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0" />
            )}
            <p>
              <span className="font-semibold">
                {satisfied ? "Condition satisfied — payout eligible" : "Threshold met — no payout due"}
              </span>
              <br />
              {satisfied
                ? `Recorded ${rainfall.toFixed(1)} mm is below the ${trigger} mm trigger, so the policy becomes eligible to claim.`
                : `Recorded ${rainfall.toFixed(1)} mm is at or above the ${trigger} mm trigger, so the covered activity was not rain-starved.`}
            </p>
          </div>
        </Reveal>

        <Reveal delay={140} className="lg:col-span-7">
          <div className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-display text-[1.0625rem] font-semibold">
                  Cumulative rainfall over the coverage window
                </div>
                <div className="mt-1 text-[0.75rem] text-muted-foreground">
                  {EXAMPLE_LOCATION.name} · 30-day window
                </div>
              </div>
              <SimulatedBadge>Simulated chart</SimulatedBadge>
            </div>

            <div className="mt-6">
              <RainfallChart rainfallMm={rainfall} triggerMm={trigger} />
            </div>

            <p className="mt-6 flex items-start gap-2 border-t border-border pt-5 text-[0.75rem] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              These are simulated values generated in your browser for demonstration. They are not a
              live weather feed, an oracle attestation or an on-chain payout. Live readings come from
              the Open-Meteo archive on the Weather Oracle page.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* Section F — Coverage and premium ---------------------------------- */

function CoveragePremiumSection() {
  const rows = [
    { icon: MapPin, label: "Covered location", value: EXAMPLE_LOCATION.name, tone: "text-foreground" },
    {
      icon: Compass,
      label: "Coverage dates",
      value: "1 Jun – 30 Jul · 60 days",
      tone: "text-foreground",
    },
    {
      icon: Gauge,
      label: "Rainfall trigger",
      value: `below ${EXAMPLE_TRIGGER_MM} mm`,
      tone: "text-rain-strong",
    },
    {
      icon: Banknote,
      label: "Payout if eligible",
      value: `${EXAMPLE_COVERAGE_ETH} ETH`,
      tone: "text-sage-strong",
    },
  ];

  const premiumMath = [
    { label: "Coverage", value: `${EXAMPLE_PREMIUM.coverageEth} ETH` },
    {
      label: "Base rate",
      value: `${(BASE_RATE_PER_30_DAYS * 100).toFixed(0)}% per 30 days × ${EXAMPLE_PREMIUM.dayFactor}`,
    },
    { label: "Trigger factor", value: `×${EXAMPLE_PREMIUM.thresholdFactor}` },
  ];

  return (
    <section id="coverage" className="border-y border-border bg-card">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <Reveal className="lg:col-span-5">
            <Eyebrow>Coverage and premium</Eyebrow>
            <h2 className="mt-5 font-display text-[2rem] leading-[1.1] font-semibold tracking-tight sm:text-[2.5rem]">
              What you pay, and what it covers.
            </h2>
            <p className="mt-5 text-[1.0625rem] leading-relaxed text-muted-foreground">
              Four inputs produce your premium: coverage amount, coverage length, rainfall trigger and
              the base rate. Nothing else is applied.
            </p>

            <dl className="mt-8 divide-y divide-border overflow-hidden rounded-2xl border border-border">
              {premiumMath.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-6 bg-card px-5 py-3.5"
                >
                  <dt className="text-[0.875rem] text-muted-foreground">{row.label}</dt>
                  <dd className="text-[0.875rem] font-medium tabular-nums">{row.value}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-6 bg-lavender/25 px-5 py-4">
                <dt className="text-[0.875rem] font-semibold text-lavender-strong">Premium due</dt>
                <dd className="font-display text-xl font-semibold tabular-nums text-lavender-strong">
                  {EXAMPLE_PREMIUM_ETH} ETH
                </dd>
              </div>
            </dl>

            <p className="mt-5 flex items-start gap-2 text-[0.75rem] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Illustrative example. The premium is computed live by SkyCover&rsquo;s own formula, so
              the ratio between premium and payout is the real one.
            </p>

            <Button asChild className="group mt-8">
              <Link to="/buy">
                Build your own policy
                <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </Reveal>

          <Reveal delay={140} className="lg:col-span-7">
            <div className="overflow-hidden rounded-3xl border border-border bg-background shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-lavender/25 px-6 py-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-card text-lavender-strong">
                    <ShieldCheck className="size-[1.125rem]" />
                  </span>
                  <div>
                    <div className="font-display text-[0.9375rem] font-semibold">Policy SC-0001</div>
                    <div className="text-[0.6875rem] text-muted-foreground">
                      Parametric rainfall cover
                    </div>
                  </div>
                </div>
                <Badge variant="outline" className="border-lavender-strong/30 bg-card text-lavender-strong">
                  Active
                </Badge>
              </div>

              <dl className="divide-y divide-border">
                {rows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-6 px-6 py-4 transition-colors duration-200 hover:bg-secondary/50"
                  >
                    <dt className="flex items-center gap-3 text-[0.875rem] text-muted-foreground">
                      <row.icon className="size-4 shrink-0" />
                      {row.label}
                    </dt>
                    <dd className={`text-right text-[0.9375rem] font-medium tabular-nums ${row.tone}`}>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="border-t border-border bg-secondary/50 px-6 py-5">
                <div className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  <ScrollText className="size-3.5" /> Policy conditions
                </div>
                <ul className="mt-4 space-y-3 text-[0.8125rem] leading-relaxed text-muted-foreground">
                  <li className="flex gap-3">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-sage-strong" aria-hidden />
                    Payout-eligible only if total recorded rainfall is strictly below{" "}
                    {EXAMPLE_TRIGGER_MM} mm.
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-sage-strong" aria-hidden />
                    Readings come from the Open-Meteo archive for the covered coordinates.
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-strong" aria-hidden />
                    The payout is capped by the liquidity available in the pool at claim time.
                  </li>
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* Section G — Trust and transparency -------------------------------- */

function TrustSection() {
  const onchain = isOnchainEnabled();
  const wallet = useWallet();

  return (
    <section className="hairline-grid">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
        <Reveal className="max-w-2xl">
          <Eyebrow>Trust and transparency</Eyebrow>
          <h2 className="mt-5 font-display text-[2rem] leading-[1.1] font-semibold tracking-tight sm:text-[2.5rem]">
            Four things you should be able to check yourself.
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_PILLARS.map((pillar, i) => (
            <Reveal key={pillar.title} delay={i * 90}>
              <div className="h-full rounded-2xl border border-border bg-card p-6 shadow-soft transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-lift">
                <span className="flex size-9 items-center justify-center rounded-xl bg-forest-tint text-forest">
                  <pillar.icon className="size-[1.125rem]" />
                </span>
                <h3 className="mt-4 font-display text-[1rem] font-semibold tracking-tight">
                  {pillar.title}
                </h3>
                <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
                  {pillar.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-10">
          <div
            className={`rounded-3xl border px-6 py-7 sm:px-8 ${onchain ? "border-sage bg-sage/25" : "border-amber bg-amber/20"
              }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`flex size-9 items-center justify-center rounded-xl ${onchain ? "bg-sage text-sage-strong" : "bg-amber text-amber-strong"
                  }`}
              >
                {onchain ? (
                  <BadgeCheck className="size-[1.125rem]" />
                ) : (
                  <GraduationCap className="size-[1.125rem]" />
                )}
              </span>
              <h3
                className={`font-display text-[1.0625rem] font-semibold ${onchain ? "text-sage-strong" : "text-amber-strong"
                  }`}
              >
                {onchain ? "Contracts are live on Sepolia" : "Contracts are not deployed yet"}
              </h3>
            </div>

            <p className="mt-4 max-w-3xl text-[0.875rem] leading-relaxed text-muted-foreground">
              {onchain ? (
                <>
                  SkyCoverInsurance is deployed at{" "}
                  <span className="font-mono text-[0.8125rem] text-foreground">
                    {CONTRACTS.insurance}
                  </span>
                  . Policies, premiums and payouts below are real testnet transactions with verifiable
                  hashes.
                </>
              ) : (
                <>
                  SkyCoverInsurance has not been deployed to Sepolia, so every policy, premium, pool
                  entry and payout on this site is stored in a local demo ledger in your browser.
                  Nothing is broadcast and no testnet ETH moves. When an address is configured in{" "}
                  <span className="font-mono text-[0.8125rem] text-foreground">src/lib/chain.ts</span>
                  , the same screens switch to signed on-chain transactions.
                </>
              )}
            </p>

            <dl className="mt-7 grid gap-6 border-t border-border/70 pt-7 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-[0.625rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  Network
                </dt>
                <dd className="mt-1 text-[0.875rem] font-medium">
                  {SEPOLIA_CHAIN_NAME} · chain 11155111
                </dd>
              </div>
              <div>
                <dt className="text-[0.625rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  Insurance contract
                </dt>
                <dd className="mt-1 font-mono text-[0.8125rem]">
                  {CONTRACTS.insurance ?? "not deployed"}
                </dd>
              </div>
              <div>
                <dt className="text-[0.625rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  Weather source
                </dt>
                <dd className="mt-1 text-[0.875rem] font-medium">Open-Meteo archive (no key)</dd>
              </div>
              <div>
                <dt className="text-[0.625rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  Your wallet
                </dt>
                <dd className="mt-1 text-[0.875rem] font-medium">
                  {wallet.address ? (
                    <span className="font-mono text-[0.8125rem]">
                      {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                    </span>
                  ) : wallet.hasMetaMask ? (
                    "Disconnected"
                  ) : (
                    "MetaMask not detected"
                  )}
                </dd>
                {wallet.address && wallet.balanceEth && (
                  <dd className="mt-1 text-[0.75rem] text-muted-foreground tabular-nums">
                    {wallet.balanceEth} ETH ·{" "}
                    {wallet.onSepolia ? SEPOLIA_CHAIN_NAME : `chain ${wallet.chainId ?? "unknown"}`}
                  </dd>
                )}
              </div>
            </dl>
          </div>
        </Reveal>

        <Reveal delay={160} className="mt-10">
          <Accordion
            type="single"
            collapsible
            className="rounded-3xl border border-border bg-card px-6 shadow-soft sm:px-8"
          >
            {POLICY_FAQ.map((item) => (
              <AccordionItem key={item.q} value={item.q} className="last:border-b-0">
                <AccordionTrigger className="py-5 font-display text-[0.9375rem] font-semibold hover:text-terracotta-strong hover:no-underline">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="max-w-3xl pb-5 text-[0.875rem] leading-relaxed text-muted-foreground">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}

/* Section H — Final call to action ---------------------------------- */

function FinalCtaSection() {
  return (
    <section className="px-4 pb-20 sm:px-6 lg:pb-28">
      <Reveal className="mx-auto max-w-7xl">
        <div className="forest-band relative overflow-hidden rounded-[2rem] px-6 py-16 sm:px-14 sm:py-20 lg:px-20 lg:py-24">
          <div className="relative grid gap-10 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-7">
              <span className="text-[0.6875rem] font-semibold tracking-[0.18em] text-[#B9CCB5] uppercase">
                Start a policy
              </span>
              <h2 className="mt-6 font-display text-[2rem] leading-[1.08] font-semibold tracking-tight text-balance text-[#FAF8F3] sm:text-[2.5rem] lg:text-[3rem]">
                Insure the season you cannot control.
              </h2>
              <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-[#FAF8F3]/75">
                Choose a location, set a rainfall trigger and see the premium before you commit. The
                whole configuration takes a minute.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Button asChild size="lg" className="group">
                  <Link to="/buy">
                    Explore coverage
                    <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </Button>
                <Link
                  to="/oracle"
                  className="text-[0.875rem] font-medium text-[#FAF8F3]/80 underline decoration-[#FAF8F3]/35 underline-offset-4 transition-colors duration-200 hover:text-[#FAF8F3] hover:decoration-[#FAF8F3]"
                >
                  See how the oracle verifies rainfall
                </Link>
              </div>

              <p className="mt-7 text-[0.6875rem] text-[#FAF8F3]/55">
                {SEPOLIA_CHAIN_NAME} testnet prototype · not a regulated insurance product
              </p>
            </div>

            <ul className="grid gap-4 lg:col-span-5">
              {[
                { icon: MapPin, label: "Coverage and trigger in one screen" },
                { icon: CloudRain, label: "Rainfall verified from the archive" },
                { icon: Wallet, label: "Settled by a signed transaction" },
              ].map((item) => (
                <li
                  key={item.label}
                  className="flex items-center gap-3 rounded-2xl border border-white/12 bg-white/8 px-4 py-3.5"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/12 text-[#E9A18B]">
                    <item.icon className="size-4" />
                  </span>
                  <span className="text-[0.875rem] font-medium text-[#FAF8F3]">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
