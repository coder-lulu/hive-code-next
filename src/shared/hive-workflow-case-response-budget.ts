// Persisted Cases: the base includes the 98,304-byte workflow/24,576-byte team stores,
// 48,000 requirement + 240 title characters escaped at 6 bytes, 32 stage rows and create ack.
// Handoff allowance: 2,048*6 summary bytes + 32 dependency records (<700 each) + <8 KiB identity.
// Reviews fit 12 KiB; notices fit 1 KiB. Opaque refs are ASCII and at most 160 characters.
// Each draft adds <=128 KiB original proposal plus 32 KiB provenance/gaps; current intent <32 KiB.
export const HIVE_WORKFLOW_CASE_RESPONSE_PARTS = {
  base: { count: 1, bytes: 512 * 1024, structuralTokens: 16_384 },
  intent: { count: 1, bytes: 32 * 1024, structuralTokens: 512 },
  drafts: { count: 3, bytes: 160 * 1024, structuralTokens: 8192 },
  handoffs: { count: 96, bytes: 48 * 1024, structuralTokens: 1536 },
  reviews: { count: 96, bytes: 12 * 1024, structuralTokens: 384 },
  notices: { count: 96, bytes: 1024, structuralTokens: 32 }
} as const

// Rounded above the component sum (6,880 KiB / 228,864 tokens), with depth still bounded at 16.
export const HIVE_WORKFLOW_CASE_RESPONSE_BYTES = 8 * 1024 * 1024
export const HIVE_WORKFLOW_CASE_RESPONSE_STRUCTURAL_TOKENS = 262_144
export const HIVE_WORKFLOW_CASE_RESPONSE_BYTES_BY_PATH = {
  '/hive/workbench/cases/read': HIVE_WORKFLOW_CASE_RESPONSE_BYTES,
  '/hive/workbench/cases/create': HIVE_WORKFLOW_CASE_RESPONSE_BYTES
} as const
export const HIVE_WORKFLOW_CASE_RESPONSE_TOKENS_BY_PATH = {
  '/hive/workbench/cases/read': HIVE_WORKFLOW_CASE_RESPONSE_STRUCTURAL_TOKENS,
  '/hive/workbench/cases/create': HIVE_WORKFLOW_CASE_RESPONSE_STRUCTURAL_TOKENS
} as const
