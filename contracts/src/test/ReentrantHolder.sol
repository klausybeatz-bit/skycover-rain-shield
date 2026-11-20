// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SkyCoverInsurance} from "../SkyCoverInsurance.sol";

/**
 * @title ReentrantHolder
 * @notice Test-only fixture. It buys a policy and, on receiving the payout,
 *         attempts to re-enter `claimPayout` for the same policy. The attempt is
 *         swallowed so the outer claim can still succeed; the test then asserts
 *         the policy paid exactly once.
 */
contract ReentrantHolder {
    SkyCoverInsurance public immutable target;
    uint256 public policyId;
    uint256 public reentryAttempts;
    bool private attacking;

    constructor(address insurance) {
        target = SkyCoverInsurance(payable(insurance));
    }

    function buy(
        string calldata locationName,
        int256 latitude,
        int256 longitude,
        uint64 startDate,
        uint64 endDate,
        uint256 thresholdMm,
        uint256 coverageWei
    ) external payable {
        policyId = target.purchasePolicy{value: msg.value}(
            locationName,
            latitude,
            longitude,
            startDate,
            endDate,
            thresholdMm,
            coverageWei
        );
    }

    function claim() external {
        target.claimPayout(policyId);
    }

    receive() external payable {
        if (!attacking) {
            attacking = true;
            reentryAttempts += 1;
            // Try to claim again mid-transfer; the reentrancy guard must stop it.
            try target.claimPayout(policyId) {} catch {}
        }
    }
}
