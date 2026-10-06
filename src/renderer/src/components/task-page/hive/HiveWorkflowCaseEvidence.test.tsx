// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { HiveWorkflowCaseRun } from '../../../../../shared/hive-workflow-case-runs'
import { HiveWorkflowCaseDetail } from './HiveWorkflowCaseDetail'
import { HiveWorkflowCaseEvidence } from './HiveWorkflowCaseEvidence'
import type { HiveWorkflowCaseRunsModel } from './use-hive-workflow-case-runs'
import { emptyWorkflowCaseRunsState } from './hive-workflow-case-run-state'
import { workflowCaseEvidenceFixture } from './hive-workflow-case-evidence.test-fixtures'
import { workbenchId, workbenchAccountState } from './hive-workbench.test-fixtures'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.defaultValue ?? `${key}${options ? ` ${JSON.stringify(options)}` : ''}`
  })
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement
const readArtifact = vi.fn<HiveWorkflowCaseRunsModel['readArtifact']>()
const refresh = vi.fn<HiveWorkflowCaseRunsModel['refresh']>()
function model(
  runs: HiveWorkflowCaseRun[],
  patch: Partial<HiveWorkflowCaseRunsModel> = {}
): HiveWorkflowCaseRunsModel {
  return {
    ...emptyWorkflowCaseRunsState('test-scope'),
    runs,
    loaded: true,
    busy: false,
    canStart: false,
    refresh,
    readArtifact,
    start: vi.fn().mockResolvedValue(false),
    cancel: vi.fn().mockResolvedValue(false),
    clearArtifact: vi.fn(),
    ...patch
  }
}
function mount(view: HiveWorkflowCaseView, runs: HiveWorkflowCaseRunsModel, evidenceOnly = false) {
  act(() =>
    root.render(
      evidenceOnly ? (
        <HiveWorkflowCaseEvidence view={view} model={runs} />
      ) : (
        <HiveWorkflowCaseDetail view={view} runs={runs} scopeLabel="Team / Project" />
      )
    )
  )
}
function reportButton(selector: string) {
  const row = container.querySelector(selector)
  const button = [...(row?.querySelectorAll('button') ?? [])].find(
    (item) => item.textContent === 'hiveWorkflowCases.evidence.readReport'
  )
  if (!button) {
    throw new Error('Missing original report button')
  }
  return button
}
beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveAccount: {
        getState: vi.fn().mockResolvedValue(workbenchAccountState()),
        onStateChanged: () => () => {}
      }
    }
  })
  readArtifact.mockReset().mockResolvedValue(true)
  refresh.mockReset().mockResolvedValue(true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('original team results in the normal requirement detail', () => {
  it.each(['changes_requested', 'rejected'] as const)(
    'preserves native failed Tester with its real %s decision and code version',
    (decision) => {
      const f = workflowCaseEvidenceFixture(decision)
      mount(f.view, model([f.developerRun, f.testerRun]))
      const review = container.querySelector('[data-case-review]')!
      expect(review.textContent).toContain(`hiveWorkflowCases.evidence.decisions.${decision}`)
      expect(review.textContent).toContain('hiveTasks.status.failed')
      expect(review.textContent).not.toContain('hiveTasks.status.succeeded')
      expect(review.textContent).toContain(f.review.codeVersion.treeDigest)
      expect(review.textContent).toContain(f.tested.summary)
      expect(review.textContent).toContain('"attempt":1')
      expect(reportButton('[data-case-review]').getAttribute('aria-label')).toContain(
        'hiveWorkflow.roles.tester'
      )
      act(() => reportButton('[data-case-review]').click())
      expect(readArtifact).toHaveBeenCalledWith(f.testerRun, f.review.testReport.artifactRef)
    }
  )
  it('opens the original Developer report using the producer run', () => {
    const f = workflowCaseEvidenceFixture('approved')
    mount(f.view, model([f.developerRun, f.testerRun]))
    act(() => reportButton('[data-case-handoff]').click())
    expect(readArtifact).toHaveBeenCalledWith(f.developerRun, f.implementation.artifact.artifactRef)
    expect(container.querySelector('[data-case-review]')?.textContent).toContain(
      'hiveWorkflowCases.evidence.decisions.approved'
    )
  })
  it.each([
    ['case', (run: HiveWorkflowCaseRun) => ({ ...run, caseId: workbenchId(998) })],
    [
      'project',
      (run: HiveWorkflowCaseRun) => ({
        ...run,
        startRequest: { ...run.startRequest, projectId: workbenchId(998) }
      })
    ],
    [
      'space',
      (run: HiveWorkflowCaseRun) => ({ ...run, task: { ...run.task, spaceId: workbenchId(998) } })
    ],
    [
      'task',
      (run: HiveWorkflowCaseRun) => ({ ...run, task: { ...run.task, taskId: workbenchId(998) } })
    ],
    [
      'run',
      (run: HiveWorkflowCaseRun) => ({ ...run, task: { ...run.task, runId: workbenchId(998) } })
    ],
    ['attempt', (run: HiveWorkflowCaseRun) => ({ ...run, task: { ...run.task, attempt: 2 } })],
    [
      'revision',
      (run: HiveWorkflowCaseRun) => ({ ...run, task: { ...run.task, taskRevision: '2' } })
    ],
    ['employee', (run: HiveWorkflowCaseRun) => ({ ...run, employeeRef: workbenchId(998) })]
  ])('disables report preview for a foreign %s identity', (_, alter) => {
    const f = workflowCaseEvidenceFixture()
    mount(f.view, model([f.developerRun, alter(f.testerRun)]))
    expect(reportButton('[data-case-review]').disabled).toBe(true)
    act(() => reportButton('[data-case-review]').click())
    expect(readArtifact).not.toHaveBeenCalled()
    expect(container.querySelector('[data-case-review]')?.textContent).toContain(
      'hiveWorkflowCases.evidence.reportUnavailable'
    )
  })
  it.each(['missing', 'unloaded', 'duplicate', 'busy'] as const)(
    'disables report preview when %s',
    (reason) => {
      const f = workflowCaseEvidenceFixture()
      const run = reason === 'missing' ? { ...f.testerRun, artifactRefs: [] } : f.testerRun
      mount(
        f.view,
        model(reason === 'duplicate' ? [run, run] : [run], {
          loaded: reason !== 'unloaded',
          busy: reason === 'busy'
        }),
        reason === 'duplicate'
      )
      expect(reportButton('[data-case-review]').disabled).toBe(true)
      act(() => reportButton('[data-case-review]').click())
      expect(readArtifact).not.toHaveBeenCalled()
    }
  )
  it('keeps unknown execution status explicit without inferring test success', () => {
    const f = workflowCaseEvidenceFixture()
    mount(f.view, model([{ ...f.testerRun, status: 'unknown' }]))
    expect(container.querySelector('[data-case-review]')?.textContent).toContain(
      'hiveTasks.status.unknown'
    )
    expect(container.querySelector('[data-case-review]')?.textContent).toContain(
      'hiveWorkflowCases.evidence.decisions.changes_requested'
    )
  })
  it('escapes long summaries and renders the existing bounded plain text artifact preview', () => {
    const f = workflowCaseEvidenceFixture()
    const text = `<script>window.leak = true</script><iframe src="https://example.test" />${'x'.repeat(3000)}`
    const view = {
      ...f.view,
      handoffs: f.view.handoffs.map((item) => ({ ...item, summary: text }))
    }
    mount(
      view,
      model([f.developerRun, f.testerRun], {
        artifact: { name: 'test-report.md', text, truncated: false }
      })
    )
    expect(container.querySelector('[data-case-review]')?.textContent).toContain(text)
    expect(container.querySelectorAll('script,iframe')).toHaveLength(0)
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="test-report.md"]')?.value
    ).toBe(text)
  })
  it('shows pause notices as history while a newer run remains pending', () => {
    const f = workflowCaseEvidenceFixture()
    const recordedAt = '2026-10-06T02:00:00.000Z'
    const view = {
      ...f.view,
      executionNotices: [
        {
          kind: 'workflow.case-execution-notice' as const,
          eventRef: workbenchId(960),
          stageRef: f.testerRun.stageRef,
          causeRunId: workbenchId(930),
          reason: 'native_not_started' as const,
          recordedAt
        }
      ]
    }
    const pending = {
      ...f.testerRun,
      status: 'pending' as const,
      task: { ...f.testerRun.task, runId: workbenchId(912), attempt: 2, taskRevision: '2' },
      startRequest: {
        ...f.testerRun.startRequest,
        requestId: workbenchId(913),
        expectedTaskRevision: 1
      },
      artifactRefs: []
    }
    mount(view, model([f.testerRun, pending]))
    expect(container.textContent).toContain('hiveWorkflowCases.evidence.noticesHelp')
    expect(container.querySelector('[data-case-execution-notice]')?.textContent).toContain(
      'hiveWorkflowCases.evidence.reasons.native_not_started'
    )
    expect(container.querySelector('time')?.dateTime).toBe(recordedAt)
    expect(container.querySelectorAll('[data-case-stage-run]')[1]?.textContent).toContain(
      'hiveTasks.status.pending'
    )
  })
})
