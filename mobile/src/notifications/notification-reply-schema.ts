import { z } from 'zod'
import type { HiveMobilePushTestResult } from '../../../src/shared/hive-mobile-push-contract'
import { hostUnionArms, salvagedOptional } from '../../../src/shared/zod-salvage'

// The settings screen's delivery probe, checked against the handler in
// src/main/runtime/rpc/methods/notifications.ts and HiveMobilePushTestResult in
// src/shared/hive-mobile-push-contract.ts.
//
// The delivery probe is nullish-tolerant at the top level because its call site reads the payload
// through `?.`; requiring an object would replace the screen's own fallback copy with an
// RpcIncompatibleReplyError.

// The reason vocabulary is pinned to the host's own refusal arms through hostUnionArms, so an arm
// added or dropped host-side fails tsc here instead of degrading silently on the phone.
export const PUSH_TEST_REFUSAL_REASONS = hostUnionArms<
  Extract<HiveMobilePushTestResult, { accepted: false }>['reason']
>({
  not_registered: true,
  unavailable: true,
  rate_limited: true,
  rejected: true
})

/**
 * Whether the configured push service took a test notification.
 *
 * Both members are optional and both are read through `?.`:
 * notification-display-test.tsx tests `result?.accepted` and branches on `result?.reason`.
 * `reason` is a closed enum because those comparisons are the whole of what it decides. An arm
 * this build does not know degrades to the generic failure copy, matching the previous behavior.
 *
 * The schema is total so a non-object result also reaches that generic copy instead of surfacing a
 * reader error in the message slot.
 */
export const pushDeliveryTestResultSchema = z
  .looseObject({
    accepted: salvagedOptional('accepted', z.boolean()),
    reason: salvagedOptional('reason', z.enum(PUSH_TEST_REFUSAL_REASONS))
  })
  .nullish()
  .catch(undefined)
