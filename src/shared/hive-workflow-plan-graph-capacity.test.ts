import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  capacityGraph,
  capacityRef as ref,
  capacityArtifact as artifact
} from './hive-workflow-plan-graph-capacity.test-fixture'
import {
  HiveWorkflowPlanGraphReplySchema,
  HiveWorkflowPlanRunAdmissionSchema
} from './hive-workflow-plan-runs'
import { JsonTextStructureValidator } from './json-text-structure-limit'
import {
  JsonStringifyByteLimitError,
  stringifyJsonWithinByteLimit
} from './node-bounded-json-stringify'
import {
  HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_BYTES,
  HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_STRUCTURAL_TOKENS,
  HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS,
  HIVE_WORKFLOW_PLAN_RUN_RESPONSE_BYTES,
  HIVE_WORKFLOW_PLAN_RUN_RESPONSE_STRUCTURAL_TOKENS
} from './hive-workflow-plan-response-budget'

function usage(value: unknown) {
  const serialized = JSON.stringify(value)
  const validator = new JsonTextStructureValidator({
    structuralTokens: 1_000_000,
    nestingDepth: 16
  })
  validator.consume(serialized)
  return { bytes: Buffer.byteLength(serialized), ...validator.usage() }
}

describe('finite adopted graph transport capacity', () => {
  it.each([1, 16])(
    'fits bounded route budgets with %s developers and the remaining testers',
    (developerCount) => {
      const { view, proposal } = capacityGraph(developerCount)
      expect(Buffer.byteLength(JSON.stringify(proposal))).toBeLessThan(128 * 1024)
      expect(view.tasks).toHaveLength(32)
      expect(view.runs).toHaveLength(96)
      expect(view.outcomes).toHaveLength(96)
      const response = HiveWorkflowPlanGraphReplySchema.parse({
        admission: { requestId: randomUUID(), payloadFingerprint: 'f'.repeat(64), replayed: true },
        view
      })
      const measured = usage(response)
      expect(measured.bytes).toBeGreaterThan(1024 * 1024)
      expect(() => stringifyJsonWithinByteLimit(response, 1024 * 1024)).toThrow(
        JsonStringifyByteLimitError
      )
      expect(measured.structuralTokens).toBeGreaterThan(16384)
      expect(
        stringifyJsonWithinByteLimit(response, HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_BYTES).byteLength
      ).toBe(measured.bytes)
      expect(measured.structuralTokens).toBeLessThan(
        HIVE_WORKFLOW_PLAN_GRAPH_RESPONSE_STRUCTURAL_TOKENS
      )
      expect(measured.nestingDepth).toBeLessThanOrEqual(16)
      console.info('graph capacity', measured)
    }
  )
  it('measures maximum input and dependency evidence in the private run admission', () => {
    const { view, admission } = capacityGraph()
    admission.input = '\u0001'.repeat(HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS)
    admission.workflowContext.planExecution!.dependencyOutcomes = view.outcomes
      .slice(0, 32)
      .map((outcome, index) => ({
        proposalTaskRef: ref(`dependency-${index}`),
        producer: outcome.producer,
        outcomeRef: outcome.outcomeRef,
        outcomeVersion: artifact
      }))
    const parsed = HiveWorkflowPlanRunAdmissionSchema.parse(admission)
    const measured = usage(parsed)
    expect(
      stringifyJsonWithinByteLimit(parsed, HIVE_WORKFLOW_PLAN_RUN_RESPONSE_BYTES).byteLength
    ).toBe(measured.bytes)
    expect(measured.structuralTokens).toBeLessThan(
      HIVE_WORKFLOW_PLAN_RUN_RESPONSE_STRUCTURAL_TOKENS
    )
    expect(measured.nestingDepth).toBeLessThanOrEqual(16)
    console.info('admission capacity', measured, 'context', usage(parsed.workflowContext))
  })
})
