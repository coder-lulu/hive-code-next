export const HIVE_MOBILE_PUSH_REJECTION_REASONS = [
  'not_registered',
  'unavailable',
  'rate_limited',
  'rejected'
] as const

export type HiveMobilePushRejectionReason = (typeof HIVE_MOBILE_PUSH_REJECTION_REASONS)[number]

export type HiveMobilePushTestResult =
  | { accepted: true }
  | { accepted: false; reason: HiveMobilePushRejectionReason }
