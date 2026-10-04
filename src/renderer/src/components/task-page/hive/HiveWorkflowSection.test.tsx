// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import type {
  HiveWorkflowSave,
  HiveWorkflowSnapshot
} from '../../../../../shared/hive-task-workflows'
import { HiveWorkflowSection } from './HiveWorkflowSection'
import {
  deferredWorkbenchValue,
  workbenchAccountState,
  workbenchCompany,
  workbenchProject,
  workbenchTeam
} from './hive-workbench.test-fixtures'
import { savedWorkflow, workflowSnapshot } from './hive-workflow.test-fixtures'

const feedback = vi.hoisted(() => ({ saved: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: feedback.saved } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { index?: number; name?: string; revision?: number }) => {
      if (key === 'hiveWorkflow.stageLabel') {
        return `${key}:${options?.index}`
      }
      if (key === 'hiveWorkflow.listLabel') {
        return `${options?.name}:${options?.revision}`
      }
      if (key === 'hiveWorkflow.reviewHeading') {
        return `${key}:${options?.name}:${options?.revision}`
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
          hiveWorkbench.loadMore
        </button>
      )}
    </>
  )
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const company = workbenchCompany(1)
const team = workbenchTeam(company, workbenchProject(3, company), true)
const anotherTeam = workbenchTeam(company, workbenchProject(4, company), true)
const api = { listWorkflows: vi.fn(), getWorkflow: vi.fn(), saveWorkflow: vi.fn() }
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
  feedback.saved.mockReset()
  api.listWorkflows.mockResolvedValue({ items: [], nextCursor: null })
  api.saveWorkflow.mockImplementation((input: HiveWorkflowSave) =>
    Promise.resolve(savedWorkflow(input, team))
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
async function mount(currentTeam = team, account = 1) {
  await act(async () => {
    root.render(
      <HiveWorkflowSection
        key={`${account}:${currentTeam.project.id}:${currentTeam.project.binding.bindingRevision}`}
        team={currentTeam}
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
function field(id: string) {
  const found = container.querySelector<HTMLInputElement>(`#${id}`)
  if (!found) {
    throw new Error(`Missing field ${id}`)
  }
  return found
}
function change(id: string, value: string) {
  const target = field(id)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(target, value)
  target.dispatchEvent(new Event('input', { bubbles: true }))
}
async function choose(workflowId: string) {
  await act(async () => {
    const picker = container.querySelector<HTMLSelectElement>('#hive-workflow-picker')!
    picker.value = workflowId
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('visible workflow configuration', () => {
  it('offers the default editable flow without an execution or deployment control', async () => {
    await mount()
    expect(container.textContent).toContain('hiveWorkflow.empty')
    act(() => button('hiveWorkflow.newWorkflow').click())
    expect(field('hive-workflow-name').value).toBe('hiveWorkflow.defaultName')
    expect(container.querySelectorAll('ol[aria-label="hiveWorkflow.flowView"] > li')).toHaveLength(
      4
    )
    expect(container.textContent).toContain('hiveWorkflow.returnSummary')
    expect(button('hiveWorkflow.save').disabled).toBe(false)
    expect(container.textContent).not.toMatch(/codex:1|Start task|Deploy now|启动任务|立即部署/)
    expect(api.saveWorkflow).not.toHaveBeenCalled()
  })
  it('disables same-tick duplicate submission and confirms only a verified response', async () => {
    await mount()
    act(() => button('hiveWorkflow.newWorkflow').click())
    const pending = deferredWorkbenchValue<HiveWorkflowSnapshot>()
    api.saveWorkflow.mockReturnValueOnce(pending.promise)
    await act(async () => {
      const form = container.querySelector('form')!
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(api.saveWorkflow).toHaveBeenCalledOnce()
    expect(button('hiveWorkflow.save').disabled).toBe(true)
    expect(feedback.saved).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve(savedWorkflow(api.saveWorkflow.mock.calls[0][0], team))
    })
    expect(feedback.saved).toHaveBeenCalledWith('hiveWorkflow.saved')
    expect(field('hive-workflow-name').value).toBe('hiveWorkflow.defaultName')
    expect(button('hiveWorkflow.save').disabled).toBe(true)
    expect(container.textContent).toContain('hiveWorkflow.viewingVersion')
  })
  it('shows a dependency-loop error and refuses to send the graph', async () => {
    await mount()
    act(() => button('hiveWorkflow.newWorkflow').click())
    act(() => container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'hiveWorkflow.errors.dependencyCycle'
    )
    expect(button('hiveWorkflow.save').disabled).toBe(true)
    await submit()
    expect(api.saveWorkflow).not.toHaveBeenCalled()
    expect(field('hive-workflow-name').value).toBe('hiveWorkflow.defaultName')
  })
  it('requires independent testing to return to a development ancestor', async () => {
    await mount()
    act(() => button('hiveWorkflow.newWorkflow').click())
    act(() => button('hiveWorkflow.stageLabel:3').click())
    const picker = container.querySelector<HTMLSelectElement>('#hive-workflow-return')!
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      '',
      'hiveWorkflow.noReturn',
      'hiveWorkflow.stageLabel:2'
    ])
    act(() => {
      picker.value = 'none'
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'hiveWorkflow.errors.invalidReturn'
    )
    expect(button('hiveWorkflow.save').disabled).toBe(true)
  })
  it('retains name and criteria on version conflict and does not replace them while refreshing', async () => {
    const initial = workflowSnapshot(team)
    const latest = workflowSnapshot(team, 2)
    api.listWorkflows
      .mockResolvedValueOnce({ items: [initial], nextCursor: null })
      .mockResolvedValueOnce({ items: [latest], nextCursor: null })
    api.getWorkflow.mockResolvedValue(initial)
    await mount()
    await choose(initial.workflowId)
    act(() => {
      change('hive-workflow-name', 'Private draft')
      const criteria = container.querySelector<HTMLTextAreaElement>('#hive-workflow-criteria')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        criteria,
        'Private acceptance criterion'
      )
      criteria.dispatchEvent(new Event('input', { bubbles: true }))
    })
    api.saveWorkflow.mockRejectedValue(new Error('REVISION_CONFLICT'))
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'hiveWorkflow.errors.conflict'
    )
    expect(field('hive-workflow-name').value).toBe('Private draft')
    expect(container.querySelector<HTMLTextAreaElement>('#hive-workflow-criteria')?.value).toBe(
      'Private acceptance criterion'
    )
    await act(async () => {
      button('hiveWorkflow.refresh').click()
    })
    expect(field('hive-workflow-name').value).toBe('Private draft')
    expect(feedback.saved).not.toHaveBeenCalled()
  })
  it('retries service errors and does not show a saved version after refusal', async () => {
    api.listWorkflows.mockRejectedValueOnce(new Error('FORBIDDEN'))
    await mount()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'hiveWorkflow.errors.signIn'
    )
    await act(async () => {
      button('hiveWorkflow.refresh').click()
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    act(() => button('hiveWorkflow.newWorkflow').click())
    api.saveWorkflow.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'hiveWorkflow.errors.unavailable'
    )
    expect(container.querySelector('#hive-workflow-revision')).toBeNull()
    expect(feedback.saved).not.toHaveBeenCalled()
    await submit()
    expect(api.saveWorkflow.mock.calls[1][0].requestId).toBe(
      api.saveWorkflow.mock.calls[0][0].requestId
    )
    expect(feedback.saved).toHaveBeenCalledOnce()
  })
  it('reviews the actual current version before retaining the draft on a new base', async () => {
    const initial = workflowSnapshot(team)
    const latest = workflowSnapshot(team, 2, 100, 'Current saved delivery')
    api.listWorkflows.mockResolvedValue({ items: [initial], nextCursor: null })
    api.getWorkflow.mockResolvedValueOnce(initial).mockResolvedValueOnce(latest)
    await mount()
    await choose(initial.workflowId)
    act(() => change('hive-workflow-name', 'Kept delivery draft'))
    api.saveWorkflow.mockRejectedValueOnce(new Error('REVISION_CONFLICT'))
    await submit()
    await act(async () => {
      button('hiveWorkflow.reviewLatest').click()
    })
    expect(container.textContent).toContain('Current saved delivery')
    expect(container.querySelector('#hive-workflow-review-heading')?.textContent).toContain(
      'Current saved delivery'
    )
    expect(container.textContent).toContain('hiveWorkflow.reviewHelp')
    expect(field('hive-workflow-name').value).toBe('Kept delivery draft')
    act(() => button('hiveWorkflow.adoptReviewedBase').click())
    expect(field('hive-workflow-name').value).toBe('Kept delivery draft')
    await submit()
    expect(api.saveWorkflow.mock.calls[1][0]).toMatchObject({
      expectedRevision: 2,
      name: 'Kept delivery draft'
    })
    expect(feedback.saved).toHaveBeenCalledOnce()
  })
  it('shows historical criteria with read-only editing and a current-version action', async () => {
    const latest = workflowSnapshot(team, 2)
    const older = workflowSnapshot(team, 1)
    api.listWorkflows.mockResolvedValue({ items: [latest], nextCursor: null })
    api.getWorkflow
      .mockResolvedValueOnce(latest)
      .mockResolvedValueOnce(older)
      .mockResolvedValueOnce(latest)
    await mount()
    await choose(latest.workflowId)
    act(() => change('hive-workflow-revision', '1'))
    await act(async () => {
      button('hiveWorkflow.loadVersion').click()
    })
    expect(container.textContent).toContain('hiveWorkflow.historical')
    expect(field('hive-workflow-name').closest('fieldset')?.disabled).toBe(true)
    expect(button('hiveWorkflow.save').disabled).toBe(true)
    act(() => button('hiveWorkflow.stageLabel:3').click())
    expect(
      container.querySelector<HTMLTextAreaElement>('#hive-workflow-criteria')?.value
    ).toContain('hiveWorkflow.defaultCriteria.tester')
    await act(async () => {
      button('hiveWorkflow.loadLatest').click()
    })
    expect(container.textContent).not.toContain('hiveWorkflow.historical')
    expect(field('hive-workflow-name').closest('fieldset')?.disabled).toBe(false)
  })
  it('exposes pagination and sends the existing cursor rather than fetching every workflow', async () => {
    const first = workflowSnapshot(team)
    const second = workflowSnapshot(team, 1, 101)
    api.listWorkflows
      .mockResolvedValueOnce({ items: [first], nextCursor: first.workflowId })
      .mockResolvedValueOnce({ items: [second], nextCursor: null })
    await mount()
    await act(async () => {
      button('hiveWorkbench.loadMore').click()
    })
    expect(api.listWorkflows).toHaveBeenLastCalledWith({
      projectId: team.project.id,
      after: first.workflowId,
      limit: 25
    })
    expect(
      container.querySelector<HTMLSelectElement>('#hive-workflow-picker')?.options
    ).toHaveLength(3)
  })
  it.each(['project', 'account'])(
    'clears old drafts and ignores a late save on %s switch',
    async (kind) => {
      await mount()
      act(() => button('hiveWorkflow.newWorkflow').click())
      act(() => change('hive-workflow-name', 'Private old draft'))
      const pending = deferredWorkbenchValue<HiveWorkflowSnapshot>()
      api.saveWorkflow.mockReturnValueOnce(pending.promise)
      await submit()
      const input: HiveWorkflowSave = api.saveWorkflow.mock.calls[0][0]
      if (kind === 'account') {
        act(() => accountStateChanged(secondAccount))
      }
      await mount(kind === 'project' ? anotherTeam : team, kind === 'account' ? 2 : 1)
      expect(container.querySelector('#hive-workflow-name')).toBeNull()
      await act(async () => {
        pending.resolve(savedWorkflow(input, team))
      })
      expect(container.textContent).not.toContain('Private old draft')
      expect(container.querySelector('#hive-workflow-name')).toBeNull()
      expect(feedback.saved).not.toHaveBeenCalled()
    }
  )
})
