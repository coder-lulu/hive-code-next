// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import { HiveWorkflowCaseGraph } from './HiveWorkflowCaseGraph'
import { workflowCaseView } from './hive-workflow-cases.test-fixtures'
import { workflowSnapshot } from './hive-workflow.test-fixtures'
import { workbenchCompany, workbenchProject, workbenchTeam } from './hive-workbench.test-fixtures'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { index?: number; status?: string }) => {
      if (key === 'hiveWorkflow.stageLabel') {
        return `${key}:${options?.index}`
      }
      if (key === 'hiveWorkflowCases.graph.businessStatus') {
        return `${key}:${options?.status}`
      }
      return key
    }
  })
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const company = workbenchCompany(1)
const team = workbenchTeam(company, workbenchProject(3, company), true)
const snapshot = workflowSnapshot(team)
const initial = workflowCaseView(team, snapshot)
let root: Root
let container: HTMLDivElement
const controls = { startWorkflowCaseRun: vi.fn(), saveWorkflow: vi.fn(), getWorkflow: vi.fn() }
beforeEach(() => {
  Object.values(controls).forEach((mock) => mock.mockReset())
  Object.defineProperty(window, 'api', { configurable: true, value: { hiveTasks: controls } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
function render(view = initial) {
  act(() => {
    root.render(
      <HiveWorkflowCaseGraph key={`${view.id}:${view.binding.workflowRevision}`} view={view} />
    )
  })
}
function choose(index: number) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === `hiveWorkflow.stageLabel:${index}`
  )
  if (!button) {
    throw new Error('Original stage button required')
  }
  act(() => button.click())
}
function criteria() {
  return container.querySelector('[data-case-stage-criteria]')?.textContent
}
describe('original Case workflow graph', () => {
  it('uses the original current stage and only its fixed acceptance criteria', () => {
    render({ ...initial, currentStageRef: initial.workflow.definition.stages[2].stageRef })
    expect(criteria()).toContain('hiveWorkflow.defaultCriteria.tester')
    expect(criteria()).not.toContain('hiveWorkflow.defaultCriteria.product')
    expect(container.querySelectorAll('[data-workflow-stage-task]')).toHaveLength(4)
    expect(container.textContent).toContain('hiveWorkflowCases.graph.businessStatus')
    expect(container.textContent).toContain('hiveWorkflowCases.statuses.todo')
    expect(container.textContent).toContain('hiveWorkflowCases.statuses.backlog')
    expect(controls.getWorkflow).not.toHaveBeenCalled()
  })
  it('lets a reader choose any original stage without changing execution or workflow', () => {
    render()
    choose(3)
    expect(criteria()).toContain('hiveWorkflow.defaultCriteria.tester')
    choose(4)
    expect(criteria()).toContain('hiveWorkflow.defaultCriteria.ops')
    expect(Object.values(controls).every((mock) => mock.mock.calls.length === 0)).toBe(true)
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('textarea,input,[contenteditable=true]')).toBeNull()
  })
  it('keeps a chosen stage through same-Case progress and displays original business state', () => {
    render()
    choose(2)
    render({
      ...initial,
      revision: 2,
      currentStageRef: initial.workflow.definition.stages[2].stageRef,
      stageTasks: initial.stageTasks.map((task, index) => ({
        ...task,
        status: index === 1 ? 'blocked' : task.status
      }))
    })
    expect(criteria()).toContain('hiveWorkflow.defaultCriteria.developer')
    expect(container.textContent).toContain('hiveWorkflowCases.statuses.blocked')
    expect(controls.startWorkflowCaseRun).not.toHaveBeenCalled()
  })
  it('clears the selected stage on a different original Case', () => {
    render()
    choose(4)
    render(workflowCaseView(team, snapshot, 201))
    expect(criteria()).toContain('hiveWorkflow.defaultCriteria.product')
    expect(criteria()).not.toContain('hiveWorkflow.defaultCriteria.ops')
  })
  it('keeps fixed criteria when a later version exists and never fetches latest', () => {
    const latest = structuredClone(snapshot)
    latest.definition.workflowRevision = 2
    latest.definition.stages[0].acceptanceCriteria = ['New criteria for future Cases']
    controls.getWorkflow.mockResolvedValue(latest)
    render(initial)
    expect(criteria()).toContain('hiveWorkflow.defaultCriteria.product')
    expect(criteria()).not.toContain('New criteria for future Cases')
    expect(controls.getWorkflow).not.toHaveBeenCalled()
  })
  it('does not infer completion for every stage from the Case terminal kind', () => {
    const cancelled: HiveWorkflowCaseView = {
      ...initial,
      currentStageRef: null,
      terminalKind: 'cancelled',
      stageTasks: initial.stageTasks.map((task, index) => ({
        ...task,
        status: index === 0 ? 'done' : 'cancelled'
      }))
    }
    render(cancelled)
    expect(container.textContent).toContain('hiveWorkflowCases.statuses.done')
    expect(container.textContent).toContain('hiveWorkflowCases.statuses.cancelled')
    expect(container.querySelector('[aria-current=step]')).toBeNull()
    expect(container.textContent).not.toContain('hiveWorkflowCases.graph.currentStage')
  })
})
