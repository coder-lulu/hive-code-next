import { describe, expect, it } from 'vitest'
import { WorkflowPlanDraftSchema } from './workflow-plan-draft'
import { workflowPlanDraftFixture } from './workflow-plan-draft.test-fixture'
import {
  inspectWorkflowPlanProposal,
  WorkflowPlanValidationRefusalSchema
} from './workflow-plan-validation'

describe('readonly original Product plan drafts', () => {
  it('preserves original provenance and the full recomputed validated result', () => {
    const draft = workflowPlanDraftFixture()
    const original = JSON.stringify(draft)
    expect(WorkflowPlanDraftSchema.parse(draft)).toEqual(draft)
    expect(JSON.stringify(draft)).toBe(original)
    expect(draft.inspection).toMatchObject({
      kind: 'validated',
      capabilityGaps: [{ capability: 'task_graph_dispatch', blocking: true }]
    })
  })
  it.each(['spaceId', 'taskId', 'runId', 'attempt', 'taskRevision'] as const)(
    'rejects a replaced producer task %s',
    (field) => {
      const draft = workflowPlanDraftFixture()
      draft.producer.task = {
        ...draft.producer.task,
        [field]: field === 'attempt' ? 2 : 'foreign-test'
      }
      expect(WorkflowPlanDraftSchema.safeParse(draft).success).toBe(false)
    }
  )
  it('rejects non-Product producers and another employee', () => {
    const draft = workflowPlanDraftFixture()
    expect(
      WorkflowPlanDraftSchema.safeParse({
        ...draft,
        producer: { ...draft.producer, role: 'developer' }
      }).success
    ).toBe(false)
    expect(
      WorkflowPlanDraftSchema.safeParse({
        ...draft,
        producer: { ...draft.producer, employeeRef: 'employee-foreign' }
      }).success
    ).toBe(false)
  })
  it('retains the original artifact identity for every known rejection without raw contents', () => {
    const draft = workflowPlanDraftFixture()
    for (const reason of WorkflowPlanValidationRefusalSchema.options) {
      const rejected = { ...draft, inspection: { kind: 'rejected', reason } }
      expect(WorkflowPlanDraftSchema.parse(rejected)).toEqual(rejected)
      expect(WorkflowPlanDraftSchema.safeParse({ ...rejected, artifact: undefined }).success).toBe(
        false
      )
      expect(
        WorkflowPlanDraftSchema.safeParse({
          ...rejected,
          inspection: { ...rejected.inspection, text: 'Malformed synthetic JSON' }
        }).success
      ).toBe(false)
    }
  })
  it('allows the explicit missing artifact disposition only when no artifact exists', () => {
    const { artifact, ...draft } = workflowPlanDraftFixture()
    const missing = {
      ...draft,
      inspection: { kind: 'unavailable', reason: 'plan_artifact_missing' }
    }
    expect(WorkflowPlanDraftSchema.parse(missing)).toEqual(missing)
    expect(WorkflowPlanDraftSchema.safeParse({ ...missing, artifact }).success).toBe(false)
    expect(
      WorkflowPlanDraftSchema.safeParse({
        ...missing,
        inspection: { kind: 'unavailable', reason: 'historical-plan-synthesized' }
      }).success
    ).toBe(false)
  })
  it('preserves the rejected task reference from the original inspection', () => {
    const draft = workflowPlanDraftFixture()
    if (draft.inspection.kind !== 'validated') {
      throw new Error('Synthetic draft must be valid.')
    }
    draft.intent.facts.limits.maxAttempts = 1
    draft.inspection.proposal.tasks[0].maxAttempts = 2
    const inspection = inspectWorkflowPlanProposal(draft.inspection.proposal, draft.intent.facts)
    expect(inspection).toEqual({
      kind: 'rejected',
      reason: 'plan_limits_exceeded',
      taskRef: draft.inspection.proposal.tasks[0].taskRef
    })
    expect(WorkflowPlanDraftSchema.parse({ ...draft, inspection }).inspection).toEqual(inspection)
    expect(
      WorkflowPlanDraftSchema.safeParse({
        ...draft,
        inspection: { ...inspection, taskRef: 'https://invalid.test/task' }
      }).success
    ).toBe(false)
  })
  it.each(['definitionDigest', 'goalRef', 'planRevision'] as const)(
    'rejects a validated proposal with replaced %s',
    (field) => {
      const draft = workflowPlanDraftFixture()
      if (draft.inspection.kind !== 'validated') {
        throw new Error('Synthetic draft must be valid.')
      }
      draft.inspection.proposal = {
        ...draft.inspection.proposal,
        [field]:
          field === 'planRevision'
            ? 2
            : field === 'definitionDigest'
              ? '0'.repeat(64)
              : 'goal-foreign'
      }
      expect(WorkflowPlanDraftSchema.safeParse(draft).success).toBe(false)
    }
  )
  it('rejects another Case binding and a proposal exceeding the frozen policy', () => {
    const draft = workflowPlanDraftFixture()
    if (draft.inspection.kind !== 'validated') {
      throw new Error('Synthetic draft must be valid.')
    }
    const proposal = draft.inspection.proposal
    expect(
      WorkflowPlanDraftSchema.safeParse({
        ...draft,
        inspection: {
          ...draft.inspection,
          proposal: {
            ...proposal,
            binding: { ...proposal.binding, workflowRunRef: 'case-foreign' }
          }
        }
      }).success
    ).toBe(false)
    draft.intent.facts.limits.maxDurationMs = 1000
    expect(WorkflowPlanDraftSchema.safeParse(draft).success).toBe(false)
  })
  it('rejects removed, fabricated or changed capability gaps', () => {
    const draft = workflowPlanDraftFixture()
    if (draft.inspection.kind !== 'validated') {
      throw new Error('Synthetic draft must be valid.')
    }
    for (const capabilityGaps of [
      [],
      [{ capability: 'task_graph_dispatch', blocking: false }],
      [{ capability: 'task_graph_dispatch', blocking: true, sourceRef: 'made-up-test' }],
      [...draft.inspection.capabilityGaps, { capability: 'resource_loading', blocking: true }]
    ]) {
      expect(
        WorkflowPlanDraftSchema.safeParse({
          ...draft,
          inspection: { ...draft.inspection, capabilityGaps }
        }).success
      ).toBe(false)
    }
  })
  it('preserves all nineteen gaps including required and optional knowledge', () => {
    const draft = workflowPlanDraftFixture()
    if (draft.inspection.kind !== 'validated') {
      throw new Error('Synthetic draft must be valid.')
    }
    const proposal = draft.inspection.proposal
    proposal.resourceSelectionRefs = ['resource-test']
    proposal.requiredCoverage = 'effective_set_verified'
    proposal.requestedLimits.budget = { costMicros: 1, currency: 'USD' }
    proposal.knowledgeRequirements = Array.from({ length: 16 }, (_, index) => ({
      sourceRef: `knowledge-${index}`,
      required: index % 2 === 0
    }))
    draft.inspection = inspectWorkflowPlanProposal(proposal, draft.intent.facts)
    if (draft.inspection.kind !== 'validated') {
      throw new Error('Synthetic draft must be valid.')
    }
    expect(draft.inspection.capabilityGaps).toHaveLength(19)
    expect(WorkflowPlanDraftSchema.parse(draft)).toEqual(draft)
    const reordered = {
      ...draft,
      inspection: {
        ...draft.inspection,
        capabilityGaps: draft.inspection.capabilityGaps.toReversed()
      }
    }
    expect(WorkflowPlanDraftSchema.safeParse(reordered).success).toBe(false)
  })
  it('refuses an oversized gap array before visiting its elements', () => {
    const draft = workflowPlanDraftFixture()
    const capabilityGaps = Array.from({ length: 20 })
    Object.defineProperty(capabilityGaps, '0', {
      get() {
        throw new Error('Oversized gaps must not be read.')
      }
    })
    expect(() =>
      WorkflowPlanDraftSchema.safeParse({
        ...draft,
        inspection: { ...draft.inspection, capabilityGaps }
      })
    ).not.toThrow()
    expect(
      WorkflowPlanDraftSchema.safeParse({
        ...draft,
        inspection: { ...draft.inspection, capabilityGaps }
      }).success
    ).toBe(false)
  })
  it.each(['authorized', 'command', 'rawText', 'credentials', 'adopted', 'status'])(
    'rejects added %s claims at every new draft boundary',
    (key) => {
      const draft = workflowPlanDraftFixture()
      expect(WorkflowPlanDraftSchema.safeParse({ ...draft, [key]: true }).success).toBe(false)
      expect(
        WorkflowPlanDraftSchema.safeParse({
          ...draft,
          inspection: { ...draft.inspection, [key]: true }
        }).success
      ).toBe(false)
      expect(
        WorkflowPlanDraftSchema.safeParse({
          ...draft,
          outcomeVersion: { ...draft.outcomeVersion, [key]: true }
        }).success
      ).toBe(false)
      expect(
        WorkflowPlanDraftSchema.safeParse({
          ...draft,
          artifact: { ...draft.artifact, [key]: true }
        }).success
      ).toBe(false)
    }
  )
  it.each(['unknown_rejection', 'plan_artifact_missing', 'approved'])(
    'rejects an unknown rejection reason %s',
    (reason) => {
      expect(
        WorkflowPlanDraftSchema.safeParse({
          ...workflowPlanDraftFixture(),
          inspection: { kind: 'rejected', reason }
        }).success
      ).toBe(false)
    }
  )
  it('requires original input and source versions even for a rejected draft', () => {
    const draft = {
      ...workflowPlanDraftFixture(),
      inspection: { kind: 'rejected', reason: 'plan_json_invalid' }
    }
    for (const key of ['intent', 'producer', 'outcomeVersion', 'sourceInputDigest']) {
      expect(WorkflowPlanDraftSchema.safeParse({ ...draft, [key]: undefined }).success).toBe(false)
    }
    expect(
      WorkflowPlanDraftSchema.safeParse({ ...draft, sourceInputDigest: `${'d'.repeat(64)}\n` })
        .success
    ).toBe(false)
  })
})
