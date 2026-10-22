# SkyCover contracts

`SkyCoverInsurance.sol` is the reference contract for the prototype: a parametric
rain-insurance policy engine with an integrated liquidity pool.

Status: **not deployed**. The frontend runs in clearly-labelled demo mode until a
deployment exists.

## Rules enforced on-chain

- Only the deploy-time `oracle` address can call `reportRainfall`.
- `claimPayout` requires: caller is the policy holder, the coverage window has
  ended, the oracle reported a total, the total is **strictly below** the policy
  threshold, and the policy was never claimed (duplicate-claim prevention).
- Pool deposits/withdrawals use pro-rata share accounting and can never pay out
  more than the pool balance.

## Deploying to Sepolia (when ready)

```bash
# with any Solidity toolchain, e.g. Foundry:
forge create contracts/SkyCoverInsurance.sol:SkyCoverInsurance \
  --rpc-url https://rpc.sepolia.org \
  --private-key $DEPLOYER_KEY \
  --constructor-args <ORACLE_ADDRESS> \
  --value 1000000000000000000   # optional seed liquidity
```

Then paste the deployed address into `src/lib/chain.ts`:

```ts
export const CONTRACTS = {
  insurance: "0x…", // SkyCoverInsurance proxy
  pool: null,       // integrated into the insurance contract
};
```

Every on-chain feature in the UI (buying, claims, real pool deposits) activates
automatically once `insurance` is set. Never put a private key in the frontend —
MetaMask signs all transactions.
