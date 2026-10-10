import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { workflowNativeDeliveryFixture } from '../../src/shared/task-workflow/workflow-native-delivery.test-fixture.ts'
import { workflowPlanIntentFixture } from '../../src/shared/task-workflow/workflow-plan-draft.test-fixture.ts'
import { workflowPlanProposalFixture } from '../../src/shared/task-workflow/workflow-plan-proposal.test-fixture.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import {
  createWorkflowPlanDraft,
  validateWorkflowPlanDraft
} from '../../integration/paperclip/service/workflow-plan-draft-projection.mjs'
import {
  validateWorkflowPlanIntentRow,
  prepareWorkflowPlanIntent
} from '../../integration/paperclip/service/workflow-plan-intent-repository.mjs'

const sha = (value) => createHash('sha256').update(value).digest('hex')
function fixture(text) {
  const intent = workflowPlanIntentFixture()
  const delivery = workflowNativeDeliveryFixture()
  const { outcome } = delivery.asset
  outcome.context = {
    ...outcome.context,
    binding: intent.facts.binding,
    definitionDigest: intent.facts.definitionDigest,
    stageRef: intent.stageRef,
    employeeRef: intent.employeeRef,
    planIntent: intent
  }
  outcome.producer.task = intent.sourceTask
  const proposal = workflowPlanProposalFixture()
  const body = text ?? JSON.stringify(proposal)
  const artifact = {
    name: 'plan-proposal.json',
    text: body,
    version: {
      artifactRevision: 1,
      digest: sha(body),
      artifactRef: `artifact:${sha(JSON.stringify([outcome.producer.commandFingerprint, 'plan-proposal.json', sha(body)]))}`
    }
  }
  delivery.artifacts = [artifact]
  outcome.artifacts = [{ name: artifact.name, version: artifact.version }]
  delivery.asset.version = {
    artifactRevision: 1,
    digest: sha(JSON.stringify(outcome)),
    artifactRef: `artifact:${sha(JSON.stringify(outcome))}`
  }
  const input = {
    input: 'Original immutable input',
    inputDigest: digest('Original immutable input'),
    workflowContext: outcome.context,
    task: intent.sourceTask,
    caseId: intent.facts.binding.workflowRunRef,
    stageRef: intent.stageRef,
    definitionDigest: intent.facts.definitionDigest
  }
  const row = {
    account_id: 'owner',
    case_id: input.caseId,
    company_id: intent.sourceTask.spaceId,
    task_id: intent.sourceTask.taskId,
    run_id: intent.sourceTask.runId,
    stage_ref: intent.stageRef,
    intent_ref: intent.intentRef,
    plan_revision: intent.facts.planRevision,
    origin_task_id: intent.facts.goalRef,
    run_company_id: intent.sourceTask.spaceId,
    run_employee_id: intent.employeeRef,
    intent_json: intent,
    intent_digest: digest(intent)
  }
  return { intent, delivery, artifact, input, row }
}

describe('original Product plan transaction projection', () => {
  it('allocates from stored plan revision rather than Case version or Task attempt', async () => {
    const f = fixture()
    const view = {
      id: f.input.caseId,
      revision: 99,
      binding: f.intent.facts.binding,
      definitionDigest: f.intent.facts.definitionDigest,
      originTaskId: f.intent.facts.goalRef,
      workflow: { definition: { maxParallelism: 2, maxDurationMs: 60000 } },
      stageTasks: [
        {
          stageRef: f.intent.stageRef,
          role: 'product',
          taskId: f.intent.sourceTask.taskId,
          employeeRef: f.intent.employeeRef
        }
      ],
      team: { employees: f.intent.facts.authorizedRoles.map((role) => ({ role })) }
    }
    const reserved = await prepareWorkflowPlanIntent(
      async () => [{ revision: '7' }],
      view,
      { ...f.intent.sourceTask, attempt: 2 },
      f.intent.stageRef
    )
    expect(reserved.facts.planRevision).toBe(8)
    expect(reserved.sourceTask.attempt).toBe(2)
    expect(reserved.facts.limits).toEqual({
      maxTasks: 32,
      maxAttempts: 3,
      maxParallelism: 2,
      maxDurationMs: 60000
    })
  })
  it('retains original intent, input and artifact while reporting all capability gaps', () => {
    const f = fixture()
    const draft = createWorkflowPlanDraft(f.delivery, f.input, f.intent)
    expect(draft.inspection.kind).toBe('validated')
    expect(draft.inspection.capabilityGaps).toContainEqual({
      capability: 'task_graph_dispatch',
      blocking: true
    })
    expect(draft.sourceInputDigest).toBe(f.input.inputDigest)
    expect(draft.artifact).toEqual(f.artifact.version)
    expect(createWorkflowPlanDraft(f.delivery, f.input, f.intent)).toEqual(draft)
    expect(() =>
      validateWorkflowPlanDraft(draft, f.delivery.asset, f.input, f.intent)
    ).not.toThrow()
  })
  it.each([
    ['{', 'plan_json_invalid'],
    [' '.repeat(131073), 'plan_request_too_large']
  ])('keeps authenticated invalid content as rejection: %s', (text, reason) => {
    const f = fixture(text)
    const draft = createWorkflowPlanDraft(f.delivery, f.input, f.intent)
    expect(draft.inspection).toEqual({ kind: 'rejected', reason })
    expect(draft.artifact).toEqual(f.artifact.version)
  })
  it('refuses modified original bytes before classifying invalid JSON', () => {
    const f = fixture()
    f.artifact.text = '{'
    expect(() => createWorkflowPlanDraft(f.delivery, f.input, f.intent)).toThrow(
      'REVISION_CONFLICT'
    )
  })
  it('does not turn omitted manifest content into missing evidence', () => {
    const f = fixture()
    f.delivery.artifacts = []
    expect(() => createWorkflowPlanDraft(f.delivery, f.input, f.intent)).toThrow(
      'REVISION_CONFLICT'
    )
    f.delivery.asset.outcome.artifacts = []
    expect(createWorkflowPlanDraft(f.delivery, f.input, f.intent).inspection).toEqual({
      kind: 'unavailable',
      reason: 'plan_artifact_missing'
    })
  })
  it('leaves historical absent intent absent', () => {
    const f = fixture()
    delete f.input.workflowContext.planIntent
    expect(validateWorkflowPlanIntentRow(undefined, 'owner', f.input)).toBeNull()
    expect(createWorkflowPlanDraft(f.delivery, f.input, null)).toBeUndefined()
  })
  it.each([
    'account_id',
    'case_id',
    'company_id',
    'task_id',
    'run_id',
    'stage_ref',
    'intent_ref',
    'plan_revision',
    'origin_task_id',
    'intent_digest'
  ])('refuses changed stored intent %s', (field) => {
    const f = fixture()
    expect(validateWorkflowPlanIntentRow(f.row, 'owner', f.input)).toEqual(f.intent)
    f.row[field] = field === 'plan_revision' ? 99 : 'foreign'
    expect(() => validateWorkflowPlanIntentRow(f.row, 'owner', f.input)).toThrow(
      'REVISION_CONFLICT'
    )
  })
  it.each(['sourceInputDigest', 'intent', 'producer', 'outcomeVersion', 'artifact', 'inspection'])(
    'refuses a replaced draft %s',
    (field) => {
      const f = fixture()
      const draft = createWorkflowPlanDraft(f.delivery, f.input, f.intent)
      if (field === 'sourceInputDigest') {
        draft[field] = '0'.repeat(64)
      } else if (field === 'intent') {
        draft.intent.facts.goalRef = 'foreign'
      } else if (field === 'producer') {
        draft.producer.task.runId = 'foreign'
      } else if (field === 'inspection') {
        draft.inspection.capabilityGaps = []
      } else {
        draft[field].digest = '0'.repeat(64)
      }
      expect(() => validateWorkflowPlanDraft(draft, f.delivery.asset, f.input, f.intent)).toThrow()
    }
  )
})
