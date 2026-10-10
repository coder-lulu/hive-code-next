// 96 outcomes: <=24 KiB each for escaped summaries, producer, review and versions.
// Original proposal/provenance <=160 KiB; 32 mappings/projections + 96 runs fit 256 KiB.
// Rounded above 2,720 KiB and 48,000 structural tokens; nesting remains bounded at 16.
export const HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_BYTES = 4 * 1024 * 1024
export const HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_STRUCTURAL_TOKENS = 65_536
// JSON-escaped bounds: fixed Cases have four stages with at most three admitted attempts each.
export const HIVE_WORKFLOW_PLAN_PROMPT_CHARACTER_PARTS = {
  requirement: 48_000 * 6,
  proposalTask: 128 * 1024,
  sourceHandoffs: 12 * 16 * 1024,
  dependencies: 31 * 20 * 1024,
  context: 128 * 1024,
  envelope: 8 * 1024
} as const
export const HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS = 1_500_000
// Input at six JSON bytes per character plus <=192 KiB immutable admission/context.
export const HIVE_WORKFLOW_PLAN_RUN_RESPONSE_BYTES = 12 * 1024 * 1024
export const HIVE_WORKFLOW_PLAN_RUN_RESPONSE_STRUCTURAL_TOKENS = 8192

export const HIVE_WORKFLOW_PLAN_RESPONSE_BYTES_BY_PATH = {
  '/hive/workbench/plans/graph-read': HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_BYTES,
  '/hive/workbench/plans/graph-start': HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_BYTES,
  '/hive/workbench/plans/graph-cancel': HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_BYTES,
  '/hive/workbench/plans/graph-retry': HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_BYTES,
  '/hive/workbench/plans/graph-resume': HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_BYTES,
  '/hive/workbench/plans/run-read': HIVE_WORKFLOW_PLAN_RUN_RESPONSE_BYTES
} as const
export const HIVE_WORKFLOW_PLAN_RESPONSE_TOKENS_BY_PATH = {
  '/hive/workbench/plans/graph-read': HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_STRUCTURAL_TOKENS,
  '/hive/workbench/plans/graph-start': HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_STRUCTURAL_TOKENS,
  '/hive/workbench/plans/graph-cancel': HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_STRUCTURAL_TOKENS,
  '/hive/workbench/plans/graph-retry': HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_STRUCTURAL_TOKENS,
  '/hive/workbench/plans/graph-resume': HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_STRUCTURAL_TOKENS,
  '/hive/workbench/plans/run-read': HIVE_WORKFLOW_PLAN_RUN_RESPONSE_STRUCTURAL_TOKENS
} as const
