// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkflowPlanDraftSchema,
  type WorkflowPlanDraft
} from '../../../../../shared/task-workflow/workflow-plan-draft'
import { workflowPlanDraftFixture } from '../../../../../shared/task-workflow/workflow-plan-draft.test-fixture'
import {
  inspectWorkflowPlanProposal,
  WorkflowPlanValidationRefusalSchema
} from '../../../../../shared/task-workflow/workflow-plan-validation'
import { HiveWorkflowCasePlans } from './HiveWorkflowCasePlans'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values ? `:${JSON.stringify(values)}` : ''}`
  })
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
const apiRead = vi.fn(() => {
  throw new Error('Readonly plan display cannot access the API')
})
beforeEach(() => {
  apiRead.mockClear()
  Object.defineProperty(window, 'api', { configurable: true, get: apiRead })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  expect(apiRead).not.toHaveBeenCalled()
})
function render(drafts: WorkflowPlanDraft[]) {
  const original = JSON.stringify(drafts)
  drafts.forEach((draft) => WorkflowPlanDraftSchema.parse(draft))
  act(() => root.render(<HiveWorkflowCasePlans view={{ planDrafts: drafts }} />))
  expect(JSON.stringify(drafts)).toBe(original)
  expect(container.querySelector('button,a,input,textarea,form,[contenteditable=true]')).toBeNull()
}

describe('original Product plan preview', () => {
  it('shows an empty state without suggesting a missing artifact was observed', () => {
    render([])
    expect(container.textContent).toContain('plans.empty')
    expect(container.textContent).toContain('plans.readonly')
    expect(container.textContent).not.toContain('plans.missing')
    expect(container.querySelector('[data-case-plan-draft]')).toBeNull()
  })
  it('shows checked data and original provenance without granting execution', () => {
    const draft = workflowPlanDraftFixture()
    render([draft])
    expect(container.textContent).toContain('plans.states.validated')
    expect(container.textContent).toContain('plans.blocking')
    expect(container.textContent).toContain('plans.revision:{"revision":1}')
    expect(container.textContent).toContain(draft.producer.task.runId)
    expect(container.textContent).toContain(draft.outcomeVersion.digest)
    expect(container.textContent).toContain(draft.artifact?.digest)
    const disclosures = [...container.querySelectorAll('details')]
    expect(disclosures).toHaveLength(3)
    expect(
      disclosures.every(
        (details) => !details.open && details.firstElementChild?.tagName === 'SUMMARY'
      )
    ).toBe(true)
    act(() => disclosures[0].querySelector('summary')?.click())
    expect(disclosures[0].open).toBe(true)
  })
  it.each(WorkflowPlanValidationRefusalSchema.options)(
    'shows rejection %s without proposal tasks',
    (reason) => {
      render([
        {
          ...workflowPlanDraftFixture(),
          inspection: { kind: 'rejected', reason, taskRef: 'rejected-task-test' }
        }
      ])
      expect(container.textContent).toContain(`plans.reasons.${reason}`)
      expect(container.textContent).toContain('rejected-task-test')
      expect(container.querySelector('[data-plan-task]')).toBeNull()
    }
  )
  it('distinguishes an absent artifact from a rejected one and retains the outcome', () => {
    const { artifact: _artifact, ...draft } = workflowPlanDraftFixture()
    render([{ ...draft, inspection: { kind: 'unavailable', reason: 'plan_artifact_missing' } }])
    expect(container.textContent).toContain('plans.missing')
    expect(container.textContent).toContain(draft.outcomeVersion.artifactRef)
    expect(container.textContent).not.toContain('plans.artifactDigest')
    expect(container.textContent).not.toContain('plans.reasons.')
  })
  it('preserves every requested capability, all nineteen gaps, and task criteria', () => {
    const draft = workflowPlanDraftFixture()
    if (draft.inspection.kind !== 'validated') {
      throw new Error('Valid synthetic fixture required')
    }
    const proposal = draft.inspection.proposal
    proposal.resourceSelectionRefs = ['resource-selector-test']
    proposal.requiredCoverage = 'effective_set_verified'
    proposal.requestedLimits.budget = { costMicros: 123, currency: 'USD' }
    proposal.knowledgeRequirements = Array.from({ length: 16 }, (_, index) => ({
      sourceRef: `knowledge-source-${index}`,
      required: index % 2 === 0
    }))
    proposal.tasks[0].title = '<script>untrusted title</script>'
    draft.inspection = inspectWorkflowPlanProposal(proposal, draft.intent.facts)
    render([draft])
    expect(container.querySelectorAll('[data-plan-capability-gap]')).toHaveLength(19)
    expect(container.querySelectorAll('[data-plan-task]')).toHaveLength(proposal.tasks.length)
    for (const task of proposal.tasks) {
      for (const text of [task.title, task.taskRef, ...task.acceptance, ...task.dependsOn]) {
        expect(container.textContent).toContain(text)
      }
    }
    for (const source of proposal.knowledgeRequirements) {
      expect(container.textContent).toContain(source.sourceRef)
    }
    expect(container.textContent).toContain('resource-selector-test')
    expect(container.textContent).toContain('effective_set_verified')
    expect(container.textContent).toContain('plans.budget:{"costMicros":123,"currency":"USD"}')
    expect(container.textContent).toContain('plans.requestsHelp')
    expect(container.textContent).toContain('plans.optional')
    expect(container.querySelector('script')).toBeNull()
  })
  it('replaces previous Case content and does not synthesize absent requested resources', () => {
    const first = workflowPlanDraftFixture()
    render([first])
    const next = workflowPlanDraftFixture()
    next.draftRef = 'another-draft-test'
    next.producer.task.runId = next.intent.sourceTask.runId = 'another-run-test'
    render([next])
    expect(container.textContent).toContain('another-run-test')
    expect(container.textContent).not.toContain(first.producer.task.runId)
    expect(container.textContent).not.toContain('plans.resources')
    expect(container.textContent).not.toContain('plans.budget')
    render([])
    expect(container.textContent).not.toContain('another-run-test')
  })
})
