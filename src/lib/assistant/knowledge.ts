/**
 * The built-in SkyCover knowledge base.
 *
 * These answers are curated from SkyCover's own product behaviour, so the
 * assistant is useful with zero credentials and zero hallucination risk: every
 * statement here is a fact about this application, not a generated claim.
 * Questions this file does not cover fall through to live data or a cited web
 * lookup instead of being guessed at.
 */

import type { AssistantTopic } from "./types";

export interface KnowledgeEntry {
  id: string;
  title: string;
  /** Suggested phrasing shown to the farmer. */
  question: string;
  /** Lower-case phrases; a question matches on how many of them it contains. */
  keywords: string[];
  answer: string;
  /** Where the fact is documented or demonstrated in SkyCover. */
  source: { name: string; url: string };
}

export const KNOWLEDGE_BASE: ReadonlyArray<KnowledgeEntry> = [
  {
    id: "what-is-skycover",
    title: "What SkyCover is",
    question: "What is SkyCover and how does it work?",
    keywords: [
      "what is skycover",
      "what does skycover",
      "about skycover",
      "how does it work",
      "explain skycover",
      "what is this app",
      "rainfall protection",
      "parametric",
    ],
    answer:
      "SkyCover is rainfall protection: it pays out when verified rainfall at a location crosses the threshold you choose while buying. Each policy is priced at purchase and settles on a public Sepolia testnet smart contract. It is a prototype using testnet ETH — not real insurance.",
    source: { name: "SkyCover overview", url: "/" },
  },
  {
    id: "buy-policy",
    title: "How to buy cover",
    question: "How do I buy a policy?",
    keywords: [
      "how do i buy",
      "buy a policy",
      "buy insurance",
      "how to buy",
      "purchase",
      "get cover",
      "take a policy",
      "start a policy",
      "create a policy",
    ],
    answer:
      "Open Buy Insurance, choose a location, a cover amount and the rainfall threshold that should trigger a payout, then pay. You can pay with testnet ETH from a connected wallet or a UPI premium through Razorpay checkout; the policy is created once the payment settles, and it then appears under My Policies.",
    source: { name: "Buy Insurance", url: "/buy" },
  },
  {
    id: "premium-pricing",
    title: "How the premium is set",
    question: "How is the premium calculated?",
    keywords: [
      "premium",
      "how is the premium",
      "premium calculated",
      "how much does it cost",
      "cost of the policy",
      "how much do i pay",
      "policy pricing",
      "how is the price",
    ],
    answer:
      "The premium is derived from the coverage you choose — location, cover amount and rainfall threshold — by the app's premium model. The INR figure is converted from the ETH premium at a configured rate, not a live exchange rate, and the interface always shows the ETH and INR amounts side by side.",
    source: { name: "Buy Insurance", url: "/buy" },
  },
  {
    id: "covered-locations",
    title: "Where cover is available",
    question: "Which locations can I take cover for?",
    keywords: [
      "which locations",
      "what locations",
      "where can i take cover",
      "covered areas",
      "my village",
      "my area",
      "which places",
    ],
    answer:
      "SkyCover ships with sample coverage locations across India's monsoon-exposed regions — for example Cherrapunji and Guwahati in the Northeast, Kolkata and Darjeeling in the East, Munnar in the South, and Mumbai in the West. Every policy is tied to its location's latitude and longitude, because that is what the rainfall is measured against.",
    source: { name: "Buy Insurance", url: "/buy" },
  },
  {
    id: "payout-rule",
    title: "How a payout is decided",
    question: "How do payouts work?",
    keywords: [
      "how do payouts work",
      "when do i get paid",
      "how do i claim",
      "how is a claim",
      "payout happen",
      "settlement work",
      "get my money",
      "trigger a payout",
      "rain threshold",
    ],
    answer:
      "A payout can only be triggered by observed rainfall at the policy's own location over its cover window. That observed total is compared with your threshold, and when it is met the contract releases the cover. Forecast rainfall is never used to settle a claim, and mandi/market prices never influence a payout at all.",
    source: { name: "Weather Oracle", url: "/oracle" },
  },
  {
    id: "weather-source",
    title: "Where the rainfall data comes from",
    question: "Where does the rainfall data come from?",
    keywords: [
      "weather data come from",
      "rainfall data come from",
      "where does the rain",
      "weather source",
      "open-meteo",
      "open meteo",
      "imd",
      "who measures the rain",
      "data source for rain",
    ],
    answer:
      "Observed rainfall is read from the Open-Meteo historical archive, and SkyCover cross-checks it against India Meteorological Department (IMD) readings through TinyFish when an API key is configured. Every reading is shown with its source and observation time, and readings that are stale, incomplete or contradictory are rejected rather than used.",
    source: { name: "Weather Oracle", url: "/oracle" },
  },
  {
    id: "oracle-verification",
    title: "How the data is verified",
    question: "How is the oracle data verified?",
    keywords: [
      "how is the oracle",
      "oracle data verified",
      "how is the data verified",
      "oracle verification",
      "is the data verified",
      "can i trust the data",
      "claim grade",
      "verified reading",
      "oracle work",
    ],
    answer:
      "Each reading is labelled with whether it is claim-grade. Anything reported on-chain goes through a trusted verification layer that re-checks the source, location, timestamp and unit, then signs with the contract's authorised oracle account — a scraped web page can never authorise a payout on its own.",
    source: { name: "Weather Oracle", url: "/oracle" },
  },
  {
    id: "mandi-prices",
    title: "Mandi and market prices",
    question: "Where can I see mandi prices?",
    keywords: [
      "mandi price",
      "market price",
      "crop price",
      "commodity price",
      "price today",
      "selling price",
      "msp",
    ],
    answer:
      "The Mandi Prices page shows modal, minimum and maximum price per quintal for a crop, with the market date and the source it was read from. Prices are retrieved from official market sources with TinyFish and are for information only — when no source states a price the page says “Data unavailable” instead of guessing.",
    source: { name: "Mandi Prices", url: "/market" },
  },
  {
    id: "payment-methods",
    title: "How to pay the premium",
    question: "How do I pay for a policy?",
    keywords: [
      "how do i pay",
      "payment methods",
      "pay by upi",
      "razorpay",
      "pay with wallet",
      "metamask",
      "credit card",
      "pay the premium",
    ],
    answer:
      "You can pay the premium with testnet ETH from a connected wallet, or by UPI through Razorpay's hosted checkout. Razorpay handles the INR payment on its own secure page, so SkyCover never sees your card or UPI credentials.",
    source: { name: "Buy Insurance", url: "/buy" },
  },
  {
    id: "real-money",
    title: "Whether this is real insurance",
    question: "Is this real insurance with real money?",
    keywords: [
      "real money",
      "real insurance",
      "is this a real policy",
      "actual insurance",
      "licensed",
      "regulated",
      "is this safe to buy",
    ],
    answer:
      "No — SkyCover is a demonstration prototype. It uses only testnet ETH on Sepolia, it is not a licensed insurer, and it is not a financial product. No real money is involved at any point.",
    source: { name: "SkyCover overview", url: "/" },
  },
  {
    id: "policy-status",
    title: "Checking your policies",
    question: "Where can I check my policies?",
    keywords: [
      "my policies",
      "check my policies",
      "my policy status",
      "check my policy",
      "where are my policies",
      "my active policies",
      "policy number",
      "did my policy get created",
      "find my policy",
    ],
    answer:
      "My Policies lists every policy you have created with its status, cover window and rainfall threshold. The Transparency page shows the on-chain activity behind those policies.",
    source: { name: "My Policies", url: "/policies" },
  },
];

const PUNCTUATION = /[^a-z0-9\s-]/g;

function normalise(text: string): string {
  return text.toLowerCase().replace(PUNCTUATION, " ").replace(/\s+/g, " ").trim();
}

/**
 * Score each entry by the phrases it contains, weighting a multi-word phrase
 * far above a single word so that "premium" alone does not hijack a question
 * about something else. A match needs either one phrase or two single words.
 */
export function matchKnowledge(question: string): KnowledgeEntry | null {
  const q = normalise(question);
  if (q.length === 0) return null;

  let best: { entry: KnowledgeEntry; score: number } | null = null;
  for (const entry of KNOWLEDGE_BASE) {
    let score = 0;
    for (const keyword of entry.keywords) {
      const phrase = normalise(keyword);
      if (phrase.length > 0 && q.includes(phrase)) score += phrase.includes(" ") ? 3 : 1;
    }
    if (score > 0 && (best === null || score > best.score)) best = { entry, score };
  }

  return best !== null && best.score >= 2 ? best.entry : null;
}

/** The built-in questions, shown to the farmer as tappable prompts. */
export function listTopics(): AssistantTopic[] {
  return KNOWLEDGE_BASE.map((entry) => ({ title: entry.title, question: entry.question }));
}

export function knowledgeSource(entry: KnowledgeEntry): {
  id: string;
  name: string;
  url: string;
  kind: "skycover";
  observedAt: null;
} {
  return {
    id: `kb-${entry.id}`,
    name: entry.source.name,
    url: entry.source.url,
    kind: "skycover",
    observedAt: null,
  };
}
