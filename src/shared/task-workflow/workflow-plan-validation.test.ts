import { describe, expect, it } from 'vitest'
import { workflowPlanProposalFixture } from './workflow-plan-proposal.test-fixture'
import { WORKFLOW_PLAN_LIMITS } from './workflow-plan-proposal'
import {
  inspectWorkflowPlanProposal,
  inspectWorkflowPlanProposalJson,
  type WorkflowPlanValidationFacts
} from './workflow-plan-validation'

function fixture() {
  const proposal = workflowPlanProposalFixture()
  const facts: WorkflowPlanValidationFacts = {
    binding: structuredClone(proposal.binding),
    definitionDigest: proposal.definitionDigest,
    goalRef: proposal.goalRef,
    planRevision: proposal.planRevision,
    authorizedRoles: ['product', 'developer', 'tester', 'ops'],
    limits: { maxTasks: 32, maxParallelism: 4, maxDurationMs: 86_400_000, maxAttempts: 3 }
  }
  return { proposal, facts }
}

describe('structured plan inspection against host facts', () => {
  it('keeps an ordinary data-valid plan explicitly unavailable for general DAG execution', () => {
    const { proposal, facts } = fixture()
    expect(inspectWorkflowPlanProposal(proposal, facts)).toEqual({
      kind: 'validated',
      proposal,
      capabilityGaps: [{ capability: 'task_graph_dispatch', blocking: true }]
    })
  })

  it.each(['companyRef', 'projectRef'] as const)('rejects substituted %s', (field) => {
    const { proposal, facts } = fixture()
    proposal.binding.scope[field] = 'synthetic:other'
    expect(inspectWorkflowPlanProposal(proposal, facts)).toEqual({
      kind: 'rejected',
      reason: 'plan_target_mismatch'
    })
  })

  it.each(['workflowRef', 'workflowRunRef'] as const)('rejects substituted %s', (field) => {
    const { proposal, facts } = fixture()
    proposal.binding[field] = 'synthetic:other'
    expect(inspectWorkflowPlanProposal(proposal, facts)).toMatchObject({
      kind: 'rejected',
      reason: 'plan_target_mismatch'
    })
  })

  it.each(['workflowRevision', 'planRevision', 'definitionDigest', 'goalRef'] as const)(
    'rejects stale or replaced %s',
    (field) => {
      const { proposal, facts } = fixture()
      if (field === 'workflowRevision') {
        proposal.binding.workflowRevision++
      } else if (field === 'planRevision') {
        proposal.planRevision++
      } else if (field === 'definitionDigest') {
        proposal.definitionDigest = 'f'.repeat(64)
      } else {
        proposal.goalRef = 'synthetic:other'
      }
      expect(inspectWorkflowPlanProposal(proposal, facts)).toMatchObject({
        kind: 'rejected',
        reason: 'plan_target_mismatch'
      })
    }
  )

  it('does not grant an existing but unassigned role', () => {
    const { proposal, facts } = fixture()
    facts.authorizedRoles = ['tester']
    expect(inspectWorkflowPlanProposal(proposal, facts)).toEqual({
      kind: 'rejected',
      reason: 'plan_role_unavailable',
      taskRef: proposal.tasks[0].taskRef
    })
  })

  it.each(['maxTasks', 'maxParallelism', 'maxDurationMs', 'maxAttempts'] as const)(
    'applies the narrower host %s limit',
    (field) => {
      const { proposal, facts } = fixture()
      if (field === 'maxTasks') {
        proposal.tasks.push({ ...proposal.tasks[0], taskRef: 'synthetic:second' })
        facts.limits.maxTasks = 1
      } else if (field === 'maxAttempts') {
        proposal.tasks[0].maxAttempts = 2
        facts.limits.maxAttempts = 1
      } else if (field === 'maxParallelism') {
        proposal.requestedLimits.maxParallelism = 2
        facts.limits.maxParallelism = 1
      } else {
        proposal.requestedLimits.maxDurationMs = 2000
        facts.limits.maxDurationMs = 1000
      }
      expect(inspectWorkflowPlanProposal(proposal, facts)).toMatchObject({
        kind: 'rejected',
        reason: 'plan_limits_exceeded'
      })
    }
  )

  it('refuses an invalid policy instead of validating with permissive defaults', () => {
    const { proposal, facts } = fixture()
    facts.limits.maxParallelism = 0
    expect(inspectWorkflowPlanProposal(proposal, facts)).toEqual({
      kind: 'rejected',
      reason: 'plan_policy_invalid'
    })
    facts.limits.maxParallelism = 4
    facts.authorizedRoles = ['product', 'product']
    expect(inspectWorkflowPlanProposal(proposal, facts)).toMatchObject({
      kind: 'rejected',
      reason: 'plan_policy_invalid'
    })
  })

  it('preserves resource, budget and knowledge requests and discloses every missing capability', () => {
    const { proposal, facts } = fixture()
    proposal.resourceSelectionRefs = ['resource:synthetic']
    proposal.requiredCoverage = 'effective_set_verified'
    proposal.requestedLimits.budget = { costMicros: 100_000, currency: 'USD' }
    proposal.knowledgeRequirements = [
      { sourceRef: 'knowledge:required', required: true },
      { sourceRef: 'knowledge:optional', required: false }
    ]
    const before = JSON.stringify({ proposal, facts })
    expect(inspectWorkflowPlanProposal(proposal, facts)).toEqual({
      kind: 'validated',
      proposal,
      capabilityGaps: [
        { capability: 'task_graph_dispatch', blocking: true },
        { capability: 'resource_loading', blocking: true },
        { capability: 'hard_budget_enforcement', blocking: true },
        { capability: 'knowledge_access', blocking: true, sourceRef: 'knowledge:required' },
        { capability: 'knowledge_access', blocking: false, sourceRef: 'knowledge:optional' }
      ]
    })
    expect(JSON.stringify({ proposal, facts })).toBe(before)
  })

  it('retains a concrete graph refusal without returning a partial plan', () => {
    const { proposal, facts } = fixture()
    proposal.tasks[0].dependsOn = ['task:missing']
    expect(inspectWorkflowPlanProposal(proposal, facts)).toEqual({
      kind: 'rejected',
      reason: 'plan_unknown_dependency'
    })
  })
})

describe('plan JSON byte boundary', () => {
  it('accepts JSON and a leading BOM without changing the proposal', () => {
    const { proposal, facts } = fixture()
    for (const prefix of ['', '\uFEFF']) {
      expect(inspectWorkflowPlanProposalJson(prefix + JSON.stringify(proposal), facts).kind).toBe(
        'validated'
      )
    }
  })

  it('rejects exact UTF-8 byte overflow even when the UTF-16 character count is below the limit', () => {
    const { facts } = fixture()
    const raw = JSON.stringify('中'.repeat(Math.ceil(WORKFLOW_PLAN_LIMITS.maxRequestBytes / 3)))
    expect(raw.length).toBeLessThan(WORKFLOW_PLAN_LIMITS.maxRequestBytes)
    expect(inspectWorkflowPlanProposalJson(raw, facts)).toEqual({
      kind: 'rejected',
      reason: 'plan_request_too_large'
    })
  })

  it('checks size before parsing and accepts the exact byte ceiling', () => {
    const { proposal, facts } = fixture()
    const json = JSON.stringify(proposal)
    const exact = `${json}${' '.repeat(WORKFLOW_PLAN_LIMITS.maxRequestBytes - json.length)}`
    expect(inspectWorkflowPlanProposalJson(exact, facts).kind).toBe('validated')
    expect(inspectWorkflowPlanProposalJson(`${exact} `, facts)).toEqual({
      kind: 'rejected',
      reason: 'plan_request_too_large'
    })
    expect(
      inspectWorkflowPlanProposalJson('{'.repeat(WORKFLOW_PLAN_LIMITS.maxRequestBytes + 1), facts)
    ).toMatchObject({ kind: 'rejected', reason: 'plan_request_too_large' })
  })

  it.each(['{', '', '"\uD800"'])('rejects malformed JSON/Unicode input %j', (raw) => {
    expect(inspectWorkflowPlanProposalJson(raw, fixture().facts)).toEqual({
      kind: 'rejected',
      reason: 'plan_json_invalid'
    })
  })

  it('does not accept scalar JSON or escaped malformed Unicode inside the proposal', () => {
    const { proposal, facts } = fixture()
    expect(inspectWorkflowPlanProposalJson('null', facts)).toMatchObject({ kind: 'rejected' })
    proposal.tasks[0].title = '\uD800'
    expect(inspectWorkflowPlanProposalJson(JSON.stringify(proposal), facts)).toMatchObject({
      kind: 'rejected',
      reason: 'plan_invalid'
    })
  })
})
