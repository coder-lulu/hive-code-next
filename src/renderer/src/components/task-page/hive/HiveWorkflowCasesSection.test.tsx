// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import type { HiveWorkflowSnapshot } from '../../../../../shared/hive-task-workflows'
import type {
  HiveWorkflowCaseCreate,
  HiveWorkflowCaseView
} from '../../../../../shared/hive-workflow-cases'
import { HiveWorkflowCasesSection } from './HiveWorkflowCasesSection'
import {
  deferredWorkbenchValue,
  workbenchAccountState,
  workbenchCompany,
  workbenchProject,
  workbenchTeam
} from './hive-workbench.test-fixtures'
import { workflowSnapshot } from './hive-workflow.test-fixtures'
import {
  submittedWorkflowCase,
  workflowCaseSummary,
  workflowCaseView
} from './hive-workflow-cases.test-fixtures'

const feedback = vi.hoisted(() => ({ submitted: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: feedback.submitted } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string; revision?: number }) => {
      if (key === 'hiveWorkflowCases.caseLabel') {
        return `${options?.title}:version:${options?.revision}`
      }
      if (key === 'hiveWorkflowCases.fixedVersion') {
        return `${key}:${options?.revision}`
      }
      return key
    }
  })
}))
vi.mock('./HiveWorkbenchPicker', () => ({
  HiveWorkbenchPicker: ({
    id,
    label,
    items,
    value,
    disabled,
    onValueChange,
    hasMore,
    onLoadMore
  }: {
    id: string
    label: string
    items: { id: string; name: string }[]
    value: string | null
    disabled: boolean
    onValueChange: (value: string) => void
    hasMore?: boolean
    onLoadMore?: () => void
  }) => (
    <>
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
      {hasMore && (
        <button type="button" disabled={disabled} onClick={onLoadMore}>
          hiveWorkflowCases.loadMore
        </button>
      )}
    </>
  )
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const company = workbenchCompany(1)
const team = workbenchTeam(company, workbenchProject(3, company), true)
const secondTeam = workbenchTeam(company, workbenchProject(4, company), true)
const workflow = workflowSnapshot(team)
const secondWorkflow = workflowSnapshot(secondTeam, 1, 101)
const api = { listWorkflowCases: vi.fn(), getWorkflowCase: vi.fn(), createWorkflowCase: vi.fn() }
const firstAccount = workbenchAccountState()
const secondAccount = workbenchAccountState('other-owner', 'other-authority')
const accountGetState = vi.fn<() => Promise<HiveAccountState>>()
const listeners = new Set<(state: HiveAccountState) => void>()
const accountStateChanged = (state: HiveAccountState) =>
  listeners.forEach((listener) => listener(state))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  listeners.clear()
  accountGetState.mockReset().mockResolvedValue(firstAccount)
  feedback.submitted.mockReset()
  api.listWorkflowCases.mockResolvedValue({ items: [], nextCursor: null })
  api.createWorkflowCase.mockImplementation((input: HiveWorkflowCaseCreate) =>
    Promise.resolve(submittedWorkflowCase(input, team, workflow))
  )
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveTasks: api,
      hiveAccount: {
        getState: accountGetState,
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
async function mount(
  currentTeam: HiveWorkbenchTeam = team,
  currentWorkflow: HiveWorkflowSnapshot = workflow,
  account = 1,
  submissionBlocked = false
) {
  await act(async () => {
    root.render(
      <HiveWorkflowCasesSection
        key={`${account}:${currentTeam.project.id}:${currentWorkflow.workflowId}`}
        team={currentTeam}
        workflow={currentWorkflow}
        submissionBlocked={submissionBlocked}
      />
    )
  })
}
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  if (!found) {
    throw new Error(`Missing button ${label}`)
  }
  return found
}
function change(id: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)
  if (!field) {
    throw new Error(`Missing field ${id}`)
  }
  const prototype =
    field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
function compose(
  title = 'Add a feature',
  requirement = 'Implement and independently test this feature'
) {
  act(() => button('hiveWorkflowCases.newRequirement').click())
  act(() => {
    change('hive-workflow-case-title', title)
    change('hive-workflow-case-requirement', requirement)
  })
}
async function submit() {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}
async function choose(caseId: string) {
  await act(async () => {
    const picker = container.querySelector<HTMLSelectElement>('#hive-workflow-case-picker')!
    picker.value = caseId
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('requirements and actual assigned workflow stages', () => {
  it('loads a bounded summary page and offers submission without claiming execution', async () => {
    await mount()
    expect(api.listWorkflowCases).toHaveBeenCalledWith({
      projectId: team.project.id,
      workflowId: workflow.workflowId,
      after: undefined,
      limit: 25
    })
    expect(button('hiveWorkflowCases.newRequirement').disabled).toBe(false)
    expect(container.textContent).toContain('hiveWorkflowCases.executionUnavailable')
    expect(container.textContent).not.toMatch(
      /Run task|Deploy now|AI decomposition complete|启动任务|立即部署|AI 已拆分/
    )
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
  })
  it('submits title and requirements against the exact saved version and confirms the real response', async () => {
    await mount()
    compose('  Add a feature  ', '  Implement and test this feature  ')
    const pending = deferredWorkbenchValue<HiveWorkflowCaseView>()
    api.createWorkflowCase.mockReturnValueOnce(pending.promise)
    await act(async () => {
      const form = container.querySelector('form')!
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(api.createWorkflowCase).toHaveBeenCalledOnce()
    expect(button('hiveWorkflowCases.submit').disabled).toBe(true)
    expect(feedback.submitted).not.toHaveBeenCalled()
    const input: HiveWorkflowCaseCreate = api.createWorkflowCase.mock.calls[0][0]
    expect(input).toMatchObject({
      projectId: team.project.id,
      workflowId: workflow.workflowId,
      workflowRevision: workflow.definition.workflowRevision,
      definitionDigest: workflow.definitionDigest,
      expectedProjectRevision: team.project.binding.bindingRevision,
      title: 'Add a feature',
      requirement: 'Implement and test this feature'
    })
    expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/)
    await act(async () => {
      pending.resolve(submittedWorkflowCase(input, team, workflow))
    })
    expect(feedback.submitted).toHaveBeenCalledWith('hiveWorkflowCases.submitted')
    expect(container.querySelector('#hive-workflow-case-title')).toBeNull()
    expect(container.querySelectorAll('[data-workflow-stage-task]')).toHaveLength(4)
    expect(container.textContent).toContain('hiveWorkflowCases.statuses.todo')
    expect(container.textContent).toContain('hiveWorkflowCases.statuses.backlog')
    expect(container.textContent).not.toContain('hiveWorkflowCases.statuses.done')
  })
  it('retains a refused draft and reuses an unchanged retry request ID', async () => {
    await mount()
    compose('Private draft', 'Private acceptance instructions')
    api.createWorkflowCase.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'hiveWorkflowCases.errors.unavailable'
    )
    expect(container.querySelector<HTMLInputElement>('#hive-workflow-case-title')?.value).toBe(
      'Private draft'
    )
    expect(
      container.querySelector<HTMLTextAreaElement>('#hive-workflow-case-requirement')?.value
    ).toBe('Private acceptance instructions')
    expect(feedback.submitted).not.toHaveBeenCalled()
    await submit()
    expect(api.createWorkflowCase.mock.calls[1][0].requestId).toBe(
      api.createWorkflowCase.mock.calls[0][0].requestId
    )
    expect(feedback.submitted).toHaveBeenCalledOnce()
  })
  it('resets the request ID after any content change even when the text is restored', async () => {
    await mount()
    compose()
    api.createWorkflowCase.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await submit()
    const firstId = api.createWorkflowCase.mock.calls[0][0].requestId
    act(() => change('hive-workflow-case-title', 'Changed title'))
    act(() => change('hive-workflow-case-title', 'Add a feature'))
    await submit()
    expect(api.createWorkflowCase.mock.calls[1][0].requestId).not.toBe(firstId)
  })
  it('does not send empty or character-oversize requirements', async () => {
    await mount()
    compose(' ', ' ')
    expect(button('hiveWorkflowCases.submit').disabled).toBe(true)
    await submit()
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
    act(() => {
      change('hive-workflow-case-title', 'Large requirement')
      change('hive-workflow-case-requirement', '验'.repeat(48_001))
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'hiveWorkflowCases.errors.invalid'
    )
    await submit()
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
  })
  it('keeps the saved version conflict explicit without rewriting requirements', async () => {
    await mount()
    compose('Conflict draft', 'Do not replace these instructions')
    api.createWorkflowCase.mockRejectedValueOnce(new Error('REVISION_CONFLICT'))
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'hiveWorkflowCases.errors.conflict'
    )
    expect(container.querySelector<HTMLInputElement>('#hive-workflow-case-title')?.value).toBe(
      'Conflict draft'
    )
    expect(feedback.submitted).not.toHaveBeenCalled()
    expect(api.getWorkflowCase).not.toHaveBeenCalled()
  })
  it('keeps summary requirements private until the selected detail is actually read', async () => {
    const view = workflowCaseView(team, workflow)
    api.listWorkflowCases.mockResolvedValue({
      items: [workflowCaseSummary(view)],
      nextCursor: null
    })
    api.getWorkflowCase.mockResolvedValue(view)
    await mount()
    expect(container.textContent).toContain(view.title)
    expect(container.textContent).not.toContain(view.requirement)
    expect(api.getWorkflowCase).not.toHaveBeenCalled()
    await choose(view.id)
    expect(container.textContent).toContain(view.requirement)
    expect(container.querySelectorAll('[data-workflow-stage-task]')).toHaveLength(4)
  })
  it('views a case fixed to an older version without changing the current definition', async () => {
    const latest = workflowSnapshot(team, 2)
    const view = workflowCaseView(team, workflow)
    api.listWorkflowCases.mockResolvedValue({
      items: [workflowCaseSummary(view)],
      nextCursor: null
    })
    api.getWorkflowCase.mockResolvedValue(view)
    await mount(team, latest)
    await choose(view.id)
    expect(container.querySelector('[data-case-fixed-version]')?.textContent).toContain(
      'hiveWorkflowCases.fixedVersion:1'
    )
    await mount(team, workflowSnapshot(team, 3, 100, 'Updated current definition'))
    expect(container.querySelector('[data-case-fixed-version]')?.textContent).toContain(
      'hiveWorkflowCases.fixedVersion:1'
    )
    expect(api.listWorkflowCases).toHaveBeenCalledOnce()
    expect(api.getWorkflowCase).toHaveBeenCalledOnce()
  })
  it('retains historical team bindings when the current team configuration has a newer revision', async () => {
    const view = workflowCaseView(team, workflow)
    const updatedTeam = structuredClone(team)
    updatedTeam.project.binding.bindingRevision = 2
    updatedTeam.employees.forEach((employee) => {
      employee.binding.bindingRevision = 2
    })
    const updatedWorkflow = { ...workflow, projectBindingRevision: 2 }
    api.listWorkflowCases.mockResolvedValue({
      items: [workflowCaseSummary(view)],
      nextCursor: null
    })
    api.getWorkflowCase.mockResolvedValue(view)
    await mount(updatedTeam, updatedWorkflow)
    await choose(view.id)
    expect(container.textContent).toContain(view.requirement)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('keeps submission unavailable for an unsaved definition or unconfigured employees', async () => {
    await mount(team, workflow, 1, true)
    expect(button('hiveWorkflowCases.newRequirement').disabled).toBe(true)
    expect(container.textContent).toContain('hiveWorkflowCases.definitionNotReady')
    await mount(workbenchTeam(company, team.project, false), workflow, 2)
    expect(button('hiveWorkflowCases.newRequirement').disabled).toBe(true)
    expect(container.textContent).toContain('hiveWorkflowCases.teamNotConfigured')
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
  })
  it('follows bounded pagination and retains earlier summaries', async () => {
    const one = workflowCaseSummary(workflowCaseView(team, workflow, 200))
    const two = workflowCaseSummary(workflowCaseView(team, workflow, 201, 'Second request'))
    api.listWorkflowCases
      .mockResolvedValueOnce({ items: [one], nextCursor: one.id })
      .mockResolvedValueOnce({ items: [two], nextCursor: null })
    await mount()
    await act(async () => {
      button('hiveWorkflowCases.loadMore').click()
    })
    expect(api.listWorkflowCases).toHaveBeenLastCalledWith({
      projectId: team.project.id,
      workflowId: workflow.workflowId,
      after: one.id,
      limit: 25
    })
    expect(
      container.querySelector<HTMLSelectElement>('#hive-workflow-case-picker')?.options
    ).toHaveLength(3)
  })
  it.each(['scope', 'body-in-summary', 'wrong-created-binding'])(
    'refuses an invalid %s response',
    async (kind) => {
      const view = workflowCaseView(
        kind === 'scope' ? secondTeam : team,
        kind === 'scope'
          ? secondWorkflow
          : kind === 'wrong-created-binding'
            ? workflowSnapshot(team, 2)
            : workflow
      )
      if (kind === 'wrong-created-binding') {
        api.createWorkflowCase.mockResolvedValue(view)
        await mount()
        compose()
        await submit()
        expect(feedback.submitted).not.toHaveBeenCalled()
      } else {
        const summary = workflowCaseSummary(view)
        api.listWorkflowCases.mockResolvedValue({
          items: [
            kind === 'body-in-summary' ? { ...summary, requirement: view.requirement } : summary
          ],
          nextCursor: null
        })
        await mount()
        expect(container.querySelector('#hive-workflow-case-picker')).toBeNull()
      }
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        kind === 'scope'
          ? 'hiveWorkflowCases.errors.forbidden'
          : 'hiveWorkflowCases.errors.invalidResponse'
      )
    }
  )
  it.each(['account', 'project', 'unmount'])(
    'discards a late create response on %s change',
    async (kind) => {
      await mount()
      compose('Private old draft', 'Private old instructions')
      const pending = deferredWorkbenchValue<HiveWorkflowCaseView>()
      api.createWorkflowCase.mockReturnValueOnce(pending.promise)
      await submit()
      const input: HiveWorkflowCaseCreate = api.createWorkflowCase.mock.calls[0][0]
      if (kind === 'account') {
        act(() => accountStateChanged(secondAccount))
        await mount(team, workflow, 2)
      }
      if (kind === 'project') {
        await mount(secondTeam, secondWorkflow)
      }
      if (kind === 'unmount') {
        act(() => root.render(<div />))
      }
      await act(async () => {
        pending.resolve(submittedWorkflowCase(input, team, workflow))
      })
      expect(container.textContent).not.toContain('Private old')
      expect(container.querySelector('[data-workflow-stage-task]')).toBeNull()
      expect(feedback.submitted).not.toHaveBeenCalled()
    }
  )
})
