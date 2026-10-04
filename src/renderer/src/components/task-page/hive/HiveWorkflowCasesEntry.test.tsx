// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import { HiveWorkflowSection } from './HiveWorkflowSection'
import {
  workbenchAccountState,
  workbenchAccountRefreshStates,
  workbenchCompany,
  workbenchProject,
  workbenchTeam
} from './hive-workbench.test-fixtures'
import { workflowSnapshot } from './hive-workflow.test-fixtures'
import { workflowCaseSummary, workflowCaseView } from './hive-workflow-cases.test-fixtures'

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { revision?: number }) =>
      key === 'hiveWorkflowCases.fixedVersion' ? `${key}:${options?.revision}` : key
  })
}))
vi.mock('./HiveWorkbenchPicker', () => ({
  HiveWorkbenchPicker: ({
    id,
    label,
    items,
    value,
    disabled,
    onValueChange
  }: {
    id: string
    label: string
    items: { id: string; name: string }[]
    value: string | null
    disabled: boolean
    onValueChange: (value: string) => void
  }) => (
    <select
      id={id}
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  )
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const company = workbenchCompany(1)
const team = workbenchTeam(company, workbenchProject(3, company), true)
const currentWorkflow = workflowSnapshot(team, 2, 100, 'Current definition')
const historicalWorkflow = workflowSnapshot(team, 1, 100, 'Historical definition')
const historicalCase = workflowCaseView(team, historicalWorkflow)
const api = {
  listWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  saveWorkflow: vi.fn(),
  listWorkflowCases: vi.fn(),
  getWorkflowCase: vi.fn(),
  createWorkflowCase: vi.fn()
}
const firstAccount = workbenchAccountState()
const listeners = new Set<(state: HiveAccountState) => void>()
const accountStateChanged = (state: HiveAccountState) =>
  listeners.forEach((listener) => listener(state))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  listeners.clear()
  api.listWorkflows.mockResolvedValue({ items: [currentWorkflow], nextCursor: null })
  api.getWorkflow.mockResolvedValue(currentWorkflow)
  api.listWorkflowCases.mockResolvedValue({
    items: [workflowCaseSummary(historicalCase)],
    nextCursor: null
  })
  api.getWorkflowCase.mockResolvedValue(historicalCase)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveTasks: api,
      hiveAccount: {
        getState: vi.fn().mockResolvedValue(firstAccount),
        onStateChanged: (listener: (state: HiveAccountState) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        }
      }
    }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
async function mount() {
  await act(async () => {
    root.render(<HiveWorkflowSection team={team} />)
  })
}
async function choose(id: string, value: string) {
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>(`#${id}`)!
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
function change(id: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!
  const prototype =
    field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('requirements entry in the selected workflow', () => {
  it('keeps workflow and requirement forms, selections and fixed case history mounted during refresh recovery', async () => {
    await mount()
    await choose('hive-workflow-picker', currentWorkflow.workflowId)
    await choose('hive-workflow-case-picker', historicalCase.id)
    const compose = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'hiveWorkflowCases.newRequirement'
    )!
    act(() => compose.click())
    act(() => {
      change('hive-workflow-case-title', 'Private feature draft')
      change('hive-workflow-case-requirement', 'Private implementation and acceptance details')
      change('hive-workflow-name', 'Private workflow draft')
      change('hive-workflow-criteria', 'Private acceptance criterion')
    })
    const name = container.querySelector<HTMLInputElement>('#hive-workflow-name')
    const criteria = container.querySelector<HTMLTextAreaElement>('#hive-workflow-criteria')
    const title = container.querySelector<HTMLInputElement>('#hive-workflow-case-title')
    const requirement = container.querySelector<HTMLTextAreaElement>(
      '#hive-workflow-case-requirement'
    )
    const fixedVersion = container.querySelector('[data-case-fixed-version]')
    expect(listeners.size).toBe(2)
    for (const account of workbenchAccountRefreshStates(firstAccount)) {
      await act(async () => accountStateChanged(account))
      expect(container.querySelector('#hive-workflow-name')).toBe(name)
      expect(container.querySelector('#hive-workflow-criteria')).toBe(criteria)
      expect(container.querySelector('#hive-workflow-case-title')).toBe(title)
      expect(container.querySelector('#hive-workflow-case-requirement')).toBe(requirement)
      expect(container.querySelector('[data-case-fixed-version]')).toBe(fixedVersion)
      expect(name?.value).toBe('Private workflow draft')
      expect(criteria?.value).toBe('Private acceptance criterion')
      expect(title?.value).toBe('Private feature draft')
      expect(requirement?.value).toBe('Private implementation and acceptance details')
      expect(container.querySelector<HTMLSelectElement>('#hive-workflow-picker')?.value).toBe(
        currentWorkflow.workflowId
      )
      expect(container.querySelector<HTMLSelectElement>('#hive-workflow-case-picker')?.value).toBe(
        historicalCase.id
      )
      expect(fixedVersion?.textContent).toBe('hiveWorkflowCases.fixedVersion:1')
    }
    expect(api.listWorkflows).toHaveBeenCalledOnce()
    expect(api.listWorkflowCases).toHaveBeenCalledOnce()
    expect(api.getWorkflow).toHaveBeenCalledOnce()
    expect(api.getWorkflowCase).toHaveBeenCalledOnce()
    expect(api.saveWorkflow).not.toHaveBeenCalled()
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
  })
  it('mounts the requirement entry by default only after selecting a real saved definition', async () => {
    await mount()
    expect(container.querySelector('#hive-workflow-cases-heading')).toBeNull()
    expect(api.listWorkflowCases).not.toHaveBeenCalled()
    await choose('hive-workflow-picker', currentWorkflow.workflowId)
    expect(container.querySelector('#hive-workflow-cases-heading')?.textContent).toBe(
      'hiveWorkflowCases.title'
    )
    expect(api.listWorkflowCases).toHaveBeenCalledWith({
      projectId: team.project.id,
      workflowId: currentWorkflow.workflowId,
      after: undefined,
      limit: 25
    })
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
  })
  it('reads an older fixed case without changing the selected current definition or calling its loader', async () => {
    await mount()
    await choose('hive-workflow-picker', currentWorkflow.workflowId)
    await choose('hive-workflow-case-picker', historicalCase.id)
    expect(container.querySelector<HTMLInputElement>('#hive-workflow-revision')?.value).toBe('2')
    expect(container.querySelector<HTMLInputElement>('#hive-workflow-name')?.value).toBe(
      'Current definition'
    )
    expect(container.querySelector('[data-case-fixed-version]')?.textContent).toBe(
      'hiveWorkflowCases.fixedVersion:1'
    )
    expect(api.getWorkflow).toHaveBeenCalledOnce()
    expect(api.getWorkflowCase).toHaveBeenCalledWith({
      projectId: team.project.id,
      caseId: historicalCase.id
    })
  })
  it('retains requirement drafts while workflow edits block submission', async () => {
    await mount()
    await choose('hive-workflow-picker', currentWorkflow.workflowId)
    const compose = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'hiveWorkflowCases.newRequirement'
    )!
    act(() => compose.click())
    act(() => change('hive-workflow-case-title', 'Retained feature draft'))
    act(() => change('hive-workflow-name', 'Unsaved workflow change'))
    expect(container.querySelector<HTMLInputElement>('#hive-workflow-case-title')?.value).toBe(
      'Retained feature draft'
    )
    expect(
      container.querySelector<HTMLInputElement>('#hive-workflow-case-title')?.closest('fieldset')
        ?.disabled
    ).toBe(true)
    const submit = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'hiveWorkflowCases.submit'
    )!
    expect(submit.disabled).toBe(true)
    await act(async () => {
      container
        .querySelector('#hive-workflow-case-title')!
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
    expect(api.listWorkflowCases).toHaveBeenCalledOnce()
  })
})
