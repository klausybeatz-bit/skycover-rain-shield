import { isPayoutEligible } from "./premium";
import { formatInr, type UpiVerification } from "./upi/types";

/**
 * Demo-mode data store. When contracts are not deployed, policies, rainfall
 * evaluations, payouts and pool activity live here (localStorage) and every
 * piece of UI built on it is labelled "Simulated — demo data". Real
 * transactions only appear once a contract address is configured.
 */
export type PolicyStatus = "active" | "eligible" | "paid" | "not_eligible" | "expired";

/**
 * How a premium was actually paid, copied from the server's verified order.
 * `verification === "simulated"` is the only value that does not come from a
 * payment gateway check.
 */
export interface UpiPaymentRecord {
  orderId: string;
  /** Gateway payment id once verified; null while unverified. */
  paymentRef: string | null;
  amountInr: number;
  amountEth: number;
  verification: UpiVerification;
  simulated: boolean;
  paidAt: number;
}

export interface DemoPolicy {
  id: string;
  policyNumber: number;
  holderAddress: string | null;
  locationName: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  thresholdMm: number;
  coverageEth: number;
  premiumEth: number;
  status: PolicyStatus;
  createdAt: number;
  /** Set only when this policy was purchased with a real on-chain transaction. */
  onchainPolicyId?: number | undefined;
  /** Set when the premium was paid through UPI, live or simulated. */
  upiPayment?: UpiPaymentRecord | undefined;
  rainfall?: {
    totalMm: number;
    scenario: "low" | "normal" | "real";
    source: string;
    evaluatedAt: number;
  };
  claimedAt?: number;
}

export type EventType =
  | "policy_created"
  | "oracle_update"
  | "pool_deposit"
  | "pool_withdraw"
  | "payout";

export interface DemoEvent {
  id: string;
  type: EventType;
  message: string;
  /** Only set for real on-chain transactions. */
  txHash?: string | undefined;
  simulated: boolean;
  at: number;
}

export interface DemoState {
  policies: DemoPolicy[];
  events: DemoEvent[];
  /** Simulated liquidity pool in ETH. No real funds are involved. */
  pool: {
    balanceEth: number;
    premiumsCollectedEth: number;
    payoutsEth: number;
  };
  nextPolicyNumber: number;
}

const STORAGE_KEY = "skycover-demo-v1";
const EMPTY_STATE: DemoState = {
  policies: [],
  events: [],
  pool: {
    balanceEth: 50,
    premiumsCollectedEth: 12.4,
    payoutsEth: 3.2,
  },
  nextPolicyNumber: 1,
};

let listeners = new Set<() => void>();

function read(): DemoState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as DemoState;
    return { ...EMPTY_STATE, ...parsed, pool: { ...EMPTY_STATE.pool, ...parsed.pool } };
  } catch {
    return EMPTY_STATE;
  }
}

let cached: DemoState | null = null;

function write(state: DemoState) {
  cached = state;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  listeners.forEach((fn) => fn());
}

export function getDemoState(): DemoState {
  if (cached === null) cached = read();
  return cached;
}

export function subscribeDemo(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Server snapshot: always the empty state so SSR never reads storage. */
export function getDemoServerState(): DemoState {
  return EMPTY_STATE;
}

function pushEvent(state: DemoState, event: Omit<DemoEvent, "id" | "at">): DemoEvent {
  const full: DemoEvent = { ...event, id: `ev-${Date.now()}-${state.events.length}`, at: Date.now() };
  state.events.unshift(full);
  return full;
}

export function createDemoPolicy(input: {
  locationName: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  thresholdMm: number;
  coverageEth: number;
  premiumEth: number;
  holderAddress: string | null;
  /** Present when the purchase was a real on-chain transaction. */
  onchainPolicyId?: number | undefined;
  txHash?: string | undefined;
  /**
   * Present when the premium was paid through UPI. This must be copied from a
   * server-verified order — never from a redirect or a client-side flag.
   */
  upiPayment?: UpiPaymentRecord | undefined;
}): DemoPolicy {
  const { txHash, ...policyInput } = input;
  const state = structuredClone(getDemoState());
  const policy: DemoPolicy = {
    id: `SC-${String(state.nextPolicyNumber).padStart(4, "0")}`,
    policyNumber: state.nextPolicyNumber,
    ...policyInput,
    status: "active",
    createdAt: Date.now(),
  };
  state.nextPolicyNumber += 1;
  state.policies.unshift(policy);
  state.pool.balanceEth += policy.premiumEth;
  state.pool.premiumsCollectedEth += policy.premiumEth;
  const upi = policy.upiPayment;
  pushEvent(state, {
    type: "policy_created",
    message:
      `Policy ${policy.id} purchased for ${policy.locationName} — premium ${policy.premiumEth} ETH, coverage ${policy.coverageEth} ETH, threshold ${policy.thresholdMm} mm` +
      (upi ? ` (premium paid via UPI: ${formatInr(upi.amountInr)}${upi.simulated ? ", simulated" : ""})` : ""),
    // A real UPI payment and a real transaction both mean this event actually
    // happened; only a purely local demo purchase is flagged simulated.
    simulated: upi ? upi.simulated : !txHash,
    txHash,
  });
  write(state);
  return policy;
}

/** Record a rainfall reading against a policy and set eligibility. */
export function applyRainfallToPolicy(
  policyId: string,
  totalMm: number,
  scenario: "low" | "normal" | "real",
  source: string,
  txHash?: string,
): DemoPolicy | null {
  const state = structuredClone(getDemoState());
  const policy = state.policies.find((p) => p.id === policyId);
  if (!policy || policy.status !== "active") return null;

  policy.rainfall = { totalMm, scenario, source, evaluatedAt: Date.now() };
  policy.status = isPayoutEligible(totalMm, policy.thresholdMm) ? "eligible" : "not_eligible";

  pushEvent(state, {
    type: "oracle_update",
    message: `Rainfall report for ${policy.id}: ${totalMm} mm total vs ${policy.thresholdMm} mm threshold → ${policy.status === "eligible" ? "payout eligible" : "no payout"}`,
    simulated: !txHash && scenario !== "real",
    txHash,
  });
  write(state);
  return policy;
}

/** Trigger the payout for an eligible policy. Guards against double claims. */
export function claimPayout(policyId: string, txHash?: string): { ok: boolean; reason?: string; policy?: DemoPolicy } {
  const state = structuredClone(getDemoState());
  const policy = state.policies.find((p) => p.id === policyId);
  if (!policy) return { ok: false, reason: "Policy not found" };
  if (policy.status === "paid") return { ok: false, reason: "Payout already claimed for this policy" };
  if (policy.status !== "eligible") {
    return { ok: false, reason: "Policy is not payout-eligible — rainfall met or exceeded the threshold" };
  }

  const payout = Math.min(policy.coverageEth, state.pool.balanceEth);
  policy.status = "paid";
  policy.claimedAt = Date.now();
  state.pool.balanceEth -= payout;
  state.pool.payoutsEth += payout;
  pushEvent(state, {
    type: "payout",
    message: `Automatic payout of ${payout} ETH sent for policy ${policy.id} (${policy.locationName}) — rainfall below ${policy.thresholdMm} mm threshold`,
    simulated: !txHash,
    txHash,
  });
  write(state);
  return { ok: true, policy };
}

export function recordPoolActivity(
  kind: "pool_deposit" | "pool_withdraw",
  amountEth: number,
  txHash?: string,
) {
  const state = structuredClone(getDemoState());
  if (kind === "pool_deposit") {
    state.pool.balanceEth += amountEth;
  } else {
    state.pool.balanceEth = Math.max(0, state.pool.balanceEth - amountEth);
  }
  pushEvent(state, {
    type: kind,
    message: `${kind === "pool_deposit" ? "Deposited" : "Withdrew"} ${amountEth} ETH ${kind === "pool_deposit" ? "into" : "from"} the liquidity pool`,
    simulated: !txHash,
    txHash,
  });
  write(state);
}

export function clearDemoData() {
  write({ ...EMPTY_STATE });
}
