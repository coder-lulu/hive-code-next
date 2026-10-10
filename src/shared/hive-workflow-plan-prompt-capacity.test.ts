import { describe, expect, it } from 'vitest'
import {
  capacityGraph,
  capacityRef,
  capacityArtifact
} from './hive-workflow-plan-graph-capacity.test-fixture'
import {
  hiveWorkflowPlanGraphContext,
  hiveWorkflowPlanGraphPrompt
} from './hive-workflow-plan-graph-context'
import {
  HiveWorkflowPlanGraphViewSchema,
  HiveWorkflowPlanRunAdmissionSchema
} from './hive-workflow-plan-runs'
import {
  HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS,
  HIVE_WORKFLOW_PLAN_PROMPT_CHARACTER_PARTS,
  HIVE_WORKFLOW_PLAN_RUN_RESPONSE_BYTES,
  HIVE_WORKFLOW_PLAN_RUN_RESPONSE_STRUCTURAL_TOKENS
} from './hive-workflow-plan-response-budget'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
import { inspectWorkflowPlanProposal } from './task-workflow/workflow-plan-validation'
import { WorkflowHandoffSchema } from './task-workflow/workflow-evidence'
import { workflowTestVectors } from './task-workflow/workflow.test-fixture'
import { JsonTextStructureValidator } from './json-text-structure-limit'
import { stringifyJsonWithinByteLimit } from './node-bounded-json-stringify'

function fanInPrompt(escaped: boolean) {
  const { view, source, proposal, admission } = capacityGraph(31)
  const employee = source.caseView.team.employees.find(
    (item) => item.role === 'product'
  )!.employeeRef
  for (const task of proposal.tasks) {
    task.requestedRole = 'product'
    task.outputKind = 'requirements'
    task.title = 'Synthetic bounded requirement'
    task.acceptance = ['Evidence-backed result']
  }
  const target = proposal.tasks[31]
  target.acceptance = Array.from({ length: 16 }, () => (escaped ? '\u0001' : 'a').repeat(1024))
  for (const mapping of view.application.createdTaskRefs) {
    mapping.employeeRef = employee
  }
  for (const task of view.tasks) {
    task.employeeRef = employee
    task.role = 'product'
  }
  for (const run of view.runs) {
    run.employeeRef = employee
    run.role = 'product'
  }
  for (const outcome of view.outcomes) {
    outcome.producer.employeeRef = employee
    outcome.producer.role = 'product'
    outcome.summary = (escaped ? '\u0001' : 'a').repeat(2048)
    delete outcome.review
    delete outcome.codeVersion
  }
  view.draft.inspection = inspectWorkflowPlanProposal(proposal, view.draft.intent.facts)
  view.application.draftDigest = digest(view.draft)
  view.application.proposalDigest = digest(proposal)
  view.graph!.draftDigest = view.application.draftDigest
  view.graph!.proposalDigest = view.application.proposalDigest
  HiveWorkflowPlanGraphViewSchema.parse(view)
  source.caseView.requirement = (escaped ? '\u0001' : 'a').repeat(48000)
  source.caseView.handoffs = Array.from({ length: 12 }, (_, index) =>
    WorkflowHandoffSchema.parse({
      ...workflowTestVectors.examples.handoff,
      handoffRef: capacityRef(`original-${index}`),
      summary: (escaped ? '\u0001' : 'a').repeat(2048),
      artifact: capacityArtifact
    })
  )
  const task = view.tasks[31]
  const run = view.runs.find((item) => item.task.runId === task.latestRun!.runId)!
  const context = hiveWorkflowPlanGraphContext(source.caseView, view, target.taskRef, run.task)
  const input = hiveWorkflowPlanGraphPrompt(source.caseView, view, target.taskRef, context)
  admission.run = run
  admission.workflowContext = context
  admission.startRequest.proposalTaskRef = target.taskRef
  admission.startRequest.attempt = run.task.attempt
  admission.input = input
  return {
    input,
    proposal,
    admission,
    requirement: source.caseView.requirement,
    acceptance: target.acceptance
  }
}

describe('actual adopted graph prompt capacity', () => {
  it('fits the full Tester snapshot completion contract within the existing envelope allocation', () => {
    const { view, source } = capacityGraph(1)
    const task = view.tasks[1]
    const context = hiveWorkflowPlanGraphContext(
      source.caseView,
      view,
      task.proposalTaskRef,
      task.latestRun!
    )
    const prompt = JSON.parse(
      hiveWorkflowPlanGraphPrompt(source.caseView, view, task.proposalTaskRef, context)
    )
    const envelope = JSON.stringify({
      instruction: prompt.instruction,
      roleCompletion: prompt.roleCompletion
    })
    expect(envelope.length).toBeLessThan(HIVE_WORKFLOW_PLAN_PROMPT_CHARACTER_PARTS.envelope)
    expect(prompt.roleCompletion).toContain(JSON.stringify(context.codeInput!.version))
    console.info('Tester completion envelope characters', envelope.length)
  })
  it('covers the full finite component bounds without dropping requirements or acceptance', () => {
    expect(
      Object.values(HIVE_WORKFLOW_PLAN_PROMPT_CHARACTER_PARTS).reduce((sum, size) => sum + size, 0)
    ).toBeLessThan(HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS)
  })
  it.each([false, true])(
    'preserves all inputs through private JSON transport, escaped=%s',
    (escaped) => {
      const { input, proposal, admission, requirement, acceptance } = fanInPrompt(escaped)
      expect(Buffer.byteLength(JSON.stringify(proposal))).toBeLessThan(128 * 1024)
      expect(input.length).toBeLessThan(HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS)
      const parsed = HiveWorkflowPlanRunAdmissionSchema.parse(admission)
      const serialized = stringifyJsonWithinByteLimit(parsed, HIVE_WORKFLOW_PLAN_RUN_RESPONSE_BYTES)
      const structure = new JsonTextStructureValidator({
        structuralTokens: HIVE_WORKFLOW_PLAN_RUN_RESPONSE_STRUCTURAL_TOKENS,
        nestingDepth: 16
      })
      structure.consume(serialized.serialized)
      const received = JSON.parse(JSON.parse(serialized.serialized).input)
      expect(received.sourceInputs).toBe(requirement)
      expect(received.task.acceptance).toEqual(acceptance)
      expect(received.dependencies).toHaveLength(31)
      expect(received.sourceAssets).toHaveLength(12)
      console.info('actual graph prompt capacity', {
        escaped,
        inputCharacters: input.length,
        responseBytes: serialized.byteLength,
        ...structure.usage()
      })
    }
  )
})
