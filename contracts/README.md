# SkyCover contracts

`src/SkyCoverInsurance.sol` is the parametric rain-insurance policy engine with an
integrated liquidity pool. `src/libraries/PremiumMath.sol` holds the premium
formula. `src/test/ReentrantHolder.sol` is a test-only fixture.

Status: **not deployed**. The frontend runs in clearly-labelled demo mode until a
deployment exists.

Sources live in `src/` (not the default `contracts/`) so this folder can be the
Hardhat project root without pulling `node_modules` into the compile glob.

## Toolchain

```bash
cd contracts
npm install
npm run compile        # solc 0.8.24, optimizer on, evm target cancun
npm test               # Hardhat + chai test suite
npm run check:env      # validate .env before deploying (no network access)
```

Test suite: `test/PremiumMath.test.ts`, `test/PolicyLifecycle.test.ts`,
`test/LiquidityPool.test.ts`, `test/Security.test.ts`.

## Policy lifecycle

1. **Purchase** — `purchasePolicy(...)` with `msg.value` equal to the premium.
   The contract recomputes the premium and rejects the call with
   `IncorrectPremium(expected, provided)` if the value does not match exactly.
   It also rejects the purchase (`InsufficientFreeLiquidity`) if the pool cannot
   cover the new coverage on top of everything already reserved (R1). The
   coverage is then reserved (`totalReservedCoverage`).
2. **Report** — once the window has ended the authorized oracle calls
   `reportRainfall(policyId, totalMm)`, at most once, within
   `REPORT_GRACE_PERIOD` (30 days) after `endDate`.
3. **Claim** — if the reported total is strictly below the threshold the holder
   calls `claimPayout(policyId)` and receives the coverage in ETH, once, within
   `CLAIM_WINDOW` (180 days) after `endDate` (R4).
4. **Release** — `releasePolicy(policyId)` releases the reserve of a policy that
   can no longer pay, so providers are not blocked by locked coverage.

## Premium formula (must match `src/lib/premium.ts`)

```
premium = coverage x 6% x (days / 30) x (1 + thresholdMm / 200)
```

No floating point is used on-chain. `PremiumMath` evaluates this as integer
basis points:

```
premiumWei = coverageWei x 600 x days x (200 + thresholdMm) / 60_000_000
```

rounded half-up to the nearest `1e12` wei (6 decimals of ETH), which is the same
rounding the frontend applies. `requiredPremium(...)` exposes the result so the
UI never has to duplicate the math.

## Configuration bounds

| Constant | Value | Meaning |
|---|---|---|
| `MIN_THRESHOLD_MM` / `MAX_THRESHOLD_MM` | 1 / 5000 | rainfall trigger range |
| `MAX_COVERAGE_WEI` | 10 ETH | hard cap on a single policy's coverage |
| `MAX_COVERAGE_DAYS` | 365 | inclusive window length cap |
| `MIN` window | 1 day | `endDate >= startDate`; `endDate < startDate` is `InvalidWindow` |
| `REPORT_GRACE_PERIOD` | 30 days | how long after `endDate` the oracle may still report |
| `CLAIM_WINDOW` | 180 days | how long an eligible policy may be claimed |
| `MAX_RAINFALL_MM` | 10 000 | larger oracle values are rejected as invalid |
| Coordinates | lat ±9000, long ±18000 | scaled by 1e2 |

## Rules enforced on-chain

- Only the oracle can report; the owner can rotate it with `setOracle`.
- One report per policy, and only between `endDate` and
  `endDate + REPORT_GRACE_PERIOD`.
- A **0 mm report is a real report** — `hasReport` distinguishes it from
  "no data yet". Missing data must never be submitted as zero; that is the
  oracle's responsibility, not the contract's.
- `claimPayout` requires: caller is the holder, the window has ended, a report
  exists, the total is strictly below the threshold, the policy was never
  claimed, its reserve was never released, the 180-day claim window is still
  open, and the pool holds enough ETH.
- `releasePolicy` succeeds only when a policy is definitively unpayable:
  reported-at-or-above-threshold, or an eligible policy whose claim window
  expired unclaimed, or an unreported policy past the report grace period. It
  reverts with `ReleaseTooEarly` while a valid claim still exists.
- Deposits/withdrawals use pro-rata share accounting, and a withdrawal can never
  take liquidity reserved by live policies (`freeLiquidity()` is the cap).
- Constructor seed liquidity is credited to the owner as ordinary shares, so it
  is accounted for fairly and cannot be withdrawn while reserved (R2).
- `pause()` / `unpause()` (owner only) halt purchases, claims, reports and pool
  movements. All state-changing entry points use a reentrancy guard and transfer
  ETH with a checked `call`.

## Deploying to Sepolia (when ready)

```bash
cd contracts
cp .env.example .env    # set DEPLOYER_PRIVATE_KEY + ORACLE_ADDRESS
npm run check:env
npm run deploy:sepolia
SKYCOVER_INSURANCE_ADDRESS=0x... npm run verify:sepolia
```

Then point the frontend at the deployed address through the public configuration
(`VITE_SKYCOVER_INSURANCE_ADDRESS` / `public/config.json`) — never by editing a
hardcoded address into the source. MetaMask signs every transaction; no private
key ever reaches the browser bundle.
