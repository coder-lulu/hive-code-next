// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import type {
  HiveWorkbenchCompanyPage,
  HiveWorkbenchProjectPage,
  HiveWorkbenchTeam
} from '../../../../../shared/hive-team-workbench'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { HiveWorkflowSnapshot } from '../../../../../shared/hive-task-workflows'
import { HiveTeamWorkbench } from './HiveTeamWorkbench'
import {
  deferredWorkbenchValue,
  workbenchAccountState,
  workbenchCompany,
  workbenchProject,
  workbenchTeam
} from './hive-workbench.test-fixtures'
import { workflowSnapshot } from './hive-workflow.test-fixtures'
import { workflowCaseSummary, workflowCaseView } from './hive-workflow-cases.test-fixtures'

vi.mock('@/store', () => ({
  useAppStore: (select: (state: object) => unknown) =>
    select({ folderWorkspaces: [], openSpacePage: vi.fn() })
}))
vi.mock('@/store/selectors', () => ({ useAllWorktrees: () => [] }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('./HiveTaskDialog', () => ({
  HiveTaskDialog: ({ label }: { label: string }) => <button type="button">{label}</button>
}))
vi.mock('./HiveWorkbenchPicker', () => ({
  HiveWorkbenchPicker: ({
    id,
    items,
    value,
    disabled,
    onValueChange,
    hasMore,
    onLoadMore
  }: {
    id: string
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
        <button type="button" data-load-more={id} disabled={disabled} onClick={onLoadMore}>
          hiveWorkbench.loadMore
        </button>
      )}
    </>
  )
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const company = workbenchCompany(1)
const otherCompany = workbenchCompany(2)
const project = workbenchProject(3, company)
const otherProject = workbenchProject(4, company)
const foreignProject = workbenchProject(5, otherCompany)
const team = workbenchTeam(company, project, true)
const otherTeam = workbenchTeam(company, otherProject, true)
const foreignTeam = workbenchTeam(otherCompany, foreignProject, true)
const workflow = workflowSnapshot(team)
const view = workflowCaseView(team, workflow)
const definitions = [
  workflow,
  workflowSnapshot(otherTeam, 1, 101),
  workflowSnapshot(foreignTeam, 1, 102)
]
const caseViews = [
  view,
  workflowCaseView(otherTeam, definitions[1], 201),
  workflowCaseView(foreignTeam, definitions[2], 202)
]
const firstAccount = workbenchAccountState()
const listeners = new Set<(state: HiveAccountState) => void>()
const api = {
  listCompanies: vi.fn(),
  createCompany: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getTeam: vi.fn(),
  configureTeam: vi.fn(),
  listWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  saveWorkflow: vi.fn(),
  listWorkflowCases: vi.fn(),
  getWorkflowCase: vi.fn(),
  createWorkflowCase: vi.fn()
}
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  listeners.clear()
  api.listCompanies.mockResolvedValue({ items: [company, otherCompany], nextCursor: null })
  api.listProjects.mockImplementation(({ companyId }: { companyId: string }) =>
    Promise.resolve({
      items: companyId === company.id ? [project, otherProject] : [foreignProject],
      nextCursor: null
    })
  )
  api.getTeam.mockImplementation((projectId: string) =>
    Promise.resolve(
      structuredClone(
        projectId === project.id ? team : projectId === otherProject.id ? otherTeam : foreignTeam
      )
    )
  )
  api.listWorkflows.mockImplementation(({ projectId }: { projectId: string }) =>
    Promise.resolve({
      items: definitions.filter((item) => item.definition.scope.projectRef === projectId),
      nextCursor: null
    })
  )
  api.getWorkflow.mockImplementation(({ workflowId }: { workflowId: string }) =>
    Promise.resolve(definitions.find((item) => item.workflowId === workflowId))
  )
  api.listWorkflowCases.mockImplementation(({ workflowId }: { workflowId: string }) =>
    Promise.resolve({
      items: caseViews
        .filter((item) => item.binding.workflowRef === workflowId)
        .map(workflowCaseSummary),
      nextCursor: null
    })
  )
  api.getWorkflowCase.mockImplementation(({ caseId }: { caseId: string }) =>
    Promise.resolve(caseViews.find((item) => item.id === caseId))
  )
  api.saveWorkflow.mockRejectedValue(new Error('SERVICE_UNAVAILABLE'))
  api.createWorkflowCase.mockRejectedValue(new Error('SERVICE_UNAVAILABLE'))
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
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  if (!found) {
    throw new Error(`Missing button ${label}`)
  }
  return found
}
function field(id: string) {
  const found = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)
  if (!found) {
    throw new Error(`Missing field ${id}`)
  }
  return found
}
function change(id: string, value: string) {
  const target = field(id)
  const prototype =
    target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(target, value)
  target.dispatchEvent(new Event('input', { bubbles: true }))
}
async function choose(id: string, value: string) {
  await act(async () => {
    const picker = container.querySelector<HTMLSelectElement>(`#${id}`)!
    picker.value = value
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function mountWorkflow() {
  await act(async () => root.render(<HiveTeamWorkbench />))
  await choose('hive-workflow-picker', workflow.workflowId)
}
async function refresh() {
  await act(async () => button('hiveWorkbench.refresh').click())
}
async function submit(fieldId: string) {
  await act(async () =>
    field(fieldId)
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  )
}
function compose() {
  act(() => button('hiveWorkflowCases.newRequirement').click())
  act(() => {
    change('hive-workflow-case-title', 'Private requirement draft')
    change('hive-workflow-case-requirement', 'Private detailed acceptance criteria')
  })
}
function assertDrafts(name: Element, title: Element, requirement: Element, selected = workflow) {
  expect(container.querySelector('#hive-workflow-name')).toBe(name)
  expect(container.querySelector('#hive-workflow-case-title')).toBe(title)
  expect(container.querySelector('#hive-workflow-case-requirement')).toBe(requirement)
  expect(field('hive-workflow-name').value).toBe('Private workflow draft')
  expect(field('hive-workflow-case-title').value).toBe('Private requirement draft')
  expect(field('hive-workflow-case-requirement').value).toBe('Private detailed acceptance criteria')
  expect(container.querySelector<HTMLSelectElement>('#hive-workflow-picker')?.value).toBe(
    selected.workflowId
  )
}

async function selectSecondPage(scope: 'company' | 'project') {
  const list = scope === 'company' ? api.listCompanies : api.listProjects
  const first = scope === 'company' ? company : project
  const second = scope === 'company' ? otherCompany : otherProject
  const pickerId = scope === 'company' ? 'hive-company' : 'hive-project'
  list.mockResolvedValueOnce({ items: [first], nextCursor: first.id })
  await act(async () => root.render(<HiveTeamWorkbench />))
  list.mockResolvedValueOnce({ items: [second], nextCursor: null })
  await act(async () => {
    container.querySelector<HTMLButtonElement>(`button[data-load-more="${pickerId}"]`)!.click()
  })
  await choose(pickerId, second.id)
  const saved = scope === 'company' ? definitions[2] : definitions[1]
  await choose('hive-workflow-picker', saved.workflowId)
  compose()
  act(() => change('hive-workflow-name', 'Private workflow draft'))
  return {
    list,
    first,
    second,
    pickerId,
    saved,
    name: field('hive-workflow-name'),
    title: field('hive-workflow-case-title'),
    requirement: field('hive-workflow-case-requirement')
  }
}

describe('outer workbench refresh preserves the actual workflow and requirement forms', () => {
  it.each(['company', 'project'] as const)(
    'preserves a %s selected from page two when the refreshed first page is incomplete',
    async (scope) => {
      const f = await selectSecondPage(scope)
      f.list.mockResolvedValueOnce({ items: [f.first], nextCursor: f.first.id })
      await refresh()
      assertDrafts(f.name, f.title, f.requirement, f.saved)
      const picker = container.querySelector<HTMLSelectElement>(`#${f.pickerId}`)!
      expect(picker.value).toBe(f.second.id)
      expect([...picker.options].map((item) => item.value)).toEqual(['', f.first.id, f.second.id])
      expect(api.getTeam).toHaveBeenLastCalledWith(f.saved.definition.scope.projectRef)
      expect(api.getTeam).toHaveBeenCalledTimes(3)
      expect(api.listWorkflows).toHaveBeenCalledTimes(2)
      expect(api.saveWorkflow).not.toHaveBeenCalled()
      expect(api.createWorkflowCase).not.toHaveBeenCalled()
    }
  )

  it.each(['company', 'project'] as const)(
    'clears a page-two %s selection when the refreshed complete list removes it',
    async (scope) => {
      const f = await selectSecondPage(scope)
      f.list.mockResolvedValueOnce({ items: [f.first], nextCursor: null })
      await refresh()
      expect(container.querySelector<HTMLSelectElement>(`#${f.pickerId}`)?.value).toBe(f.first.id)
      expect(container.querySelector('#hive-workflow-name')).toBeNull()
      expect(container.querySelector('#hive-workflow-case-title')).toBeNull()
      expect(container.textContent).not.toContain('Private detailed acceptance criteria')
      expect(api.getTeam).toHaveBeenLastCalledWith(project.id)
    }
  )

  it('keeps both private drafts and the selected fixed case through every same-scope refresh phase', async () => {
    await mountWorkflow()
    await choose('hive-workflow-case-picker', view.id)
    compose()
    act(() => change('hive-workflow-name', 'Private workflow draft'))
    const name = field('hive-workflow-name'),
      title = field('hive-workflow-case-title'),
      requirement = field('hive-workflow-case-requirement')
    const detail = container.querySelector('[data-case-fixed-version]')
    const companies = deferredWorkbenchValue<HiveWorkbenchCompanyPage>()
    const projects = deferredWorkbenchValue<HiveWorkbenchProjectPage>()
    const refreshedTeam = deferredWorkbenchValue<HiveWorkbenchTeam>()
    api.listCompanies.mockReturnValueOnce(companies.promise)
    api.listProjects.mockReturnValueOnce(projects.promise)
    api.getTeam.mockReturnValueOnce(refreshedTeam.promise)
    await refresh()
    assertDrafts(name, title, requirement)
    await act(async () => companies.resolve({ items: [company, otherCompany], nextCursor: null }))
    assertDrafts(name, title, requirement)
    await act(async () => projects.resolve({ items: [project, otherProject], nextCursor: null }))
    assertDrafts(name, title, requirement)
    await act(async () => refreshedTeam.resolve(structuredClone(team)))
    assertDrafts(name, title, requirement)
    expect(container.querySelector('[data-case-fixed-version]')).toBe(detail)
    expect(container.querySelector<HTMLSelectElement>('#hive-workflow-case-picker')?.value).toBe(
      view.id
    )
    expect(api.getTeam).toHaveBeenCalledTimes(2)
    expect(api.listWorkflows).toHaveBeenCalledOnce()
    expect(api.listWorkflowCases).toHaveBeenCalledOnce()
    expect(api.saveWorkflow).not.toHaveBeenCalled()
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
  })

  it('retains the pending workflow single flight and retry ID after a fresh equal team DTO arrives', async () => {
    await mountWorkflow()
    act(() => change('hive-workflow-name', 'Private workflow draft'))
    const pending = deferredWorkbenchValue<HiveWorkflowSnapshot>()
    api.saveWorkflow.mockReturnValueOnce(pending.promise)
    await submit('hive-workflow-name')
    const first = api.saveWorkflow.mock.calls[0][0]
    const name = field('hive-workflow-name')
    await refresh()
    expect(container.querySelector('#hive-workflow-name')).toBe(name)
    expect(field('hive-workflow-name').value).toBe('Private workflow draft')
    expect(name.closest('fieldset')?.disabled).toBe(true)
    await submit('hive-workflow-name')
    expect(api.saveWorkflow).toHaveBeenCalledOnce()
    await act(async () => pending.reject(new Error('SERVICE_UNAVAILABLE')))
    await submit('hive-workflow-name')
    expect(api.saveWorkflow).toHaveBeenCalledTimes(2)
    expect(api.saveWorkflow.mock.calls[1][0]).toEqual(first)
  })

  it('keeps a pending requirement single flight and reuses its request ID after failure', async () => {
    await mountWorkflow()
    await choose('hive-workflow-case-picker', view.id)
    compose()
    const pending = deferredWorkbenchValue<HiveWorkflowCaseView>()
    api.createWorkflowCase.mockReturnValueOnce(pending.promise)
    await submit('hive-workflow-case-title')
    const first = api.createWorkflowCase.mock.calls[0][0]
    const title = field('hive-workflow-case-title')
    await refresh()
    expect(container.querySelector('#hive-workflow-case-title')).toBe(title)
    expect(title.closest('fieldset')?.disabled).toBe(true)
    await submit('hive-workflow-case-title')
    expect(api.createWorkflowCase).toHaveBeenCalledOnce()
    await act(async () => pending.reject(new Error('SERVICE_UNAVAILABLE')))
    expect(field('hive-workflow-case-title').value).toBe('Private requirement draft')
    expect(container.querySelector<HTMLSelectElement>('#hive-workflow-case-picker')?.value).toBe(
      view.id
    )
    await submit('hive-workflow-case-title')
    expect(api.createWorkflowCase.mock.calls[1][0]).toEqual(first)
  })

  it.each(['companies', 'projects', 'team'] as const)(
    'retains drafts when the refreshed %s read fails and supports another refresh',
    async (phase) => {
      await mountWorkflow()
      compose()
      act(() => change('hive-workflow-name', 'Private workflow draft'))
      const name = field('hive-workflow-name'),
        title = field('hive-workflow-case-title'),
        requirement = field('hive-workflow-case-requirement')
      const failedRead =
        phase === 'companies'
          ? api.listCompanies
          : phase === 'projects'
            ? api.listProjects
            : api.getTeam
      failedRead.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
      await refresh()
      assertDrafts(name, title, requirement)
      expect(container.textContent).toContain('hiveWorkbench.unavailable')
      await refresh()
      assertDrafts(name, title, requirement)
    }
  )

  it.each(['company', 'project'] as const)(
    'clears drafts when the currently selected %s disappears from its refreshed list',
    async (scope) => {
      await mountWorkflow()
      compose()
      act(() => change('hive-workflow-name', 'Private workflow draft'))
      if (scope === 'company') {
        api.listCompanies.mockResolvedValueOnce({ items: [otherCompany], nextCursor: null })
      } else {
        api.listProjects.mockResolvedValueOnce({ items: [otherProject], nextCursor: null })
      }
      await refresh()
      expect(container.querySelector('#hive-workflow-name')).toBeNull()
      expect(container.querySelector('#hive-workflow-case-title')).toBeNull()
      expect(container.textContent).not.toContain('Private detailed acceptance criteria')
      expect(api.getTeam).toHaveBeenLastCalledWith(
        scope === 'company' ? foreignProject.id : otherProject.id
      )
    }
  )

  it.each(['company', 'project', 'account'] as const)(
    'clears private drafts on a real %s change and rejects the old refresh team reply',
    async (scope) => {
      await mountWorkflow()
      compose()
      act(() => change('hive-workflow-name', 'Private workflow draft'))
      const old = deferredWorkbenchValue<HiveWorkbenchTeam>()
      api.getTeam.mockReturnValueOnce(old.promise)
      await refresh()
      if (scope === 'account') {
        api.listCompanies.mockResolvedValueOnce({ items: [], nextCursor: null })
        await act(async () =>
          listeners.forEach((listener) =>
            listener(workbenchAccountState('other-owner', 'other-authority'))
          )
        )
      } else {
        await choose(
          scope === 'company' ? 'hive-company' : 'hive-project',
          scope === 'company' ? otherCompany.id : otherProject.id
        )
      }
      expect(container.querySelector('#hive-workflow-name')).toBeNull()
      expect(container.querySelector('#hive-workflow-case-title')).toBeNull()
      await act(async () => old.resolve(structuredClone(team)))
      expect(container.querySelector('#hive-workflow-name')).toBeNull()
      expect(container.querySelector('#hive-workflow-case-title')).toBeNull()
      expect(container.textContent).not.toContain('Private detailed acceptance criteria')
      if (scope === 'account') {
        expect(container.querySelector('#hive-workflow-heading')).toBeNull()
        expect(api.listWorkflows).toHaveBeenCalledOnce()
      } else {
        const selectedProject = scope === 'company' ? foreignProject : otherProject
        expect(container.querySelector<HTMLSelectElement>('#hive-project')?.value).toBe(
          selectedProject.id
        )
        expect(api.listWorkflows).toHaveBeenLastCalledWith({
          projectId: selectedProject.id,
          after: undefined,
          limit: 25
        })
        expect(api.listWorkflows).toHaveBeenCalledTimes(2)
      }
    }
  )

  it('retains drafts until the authoritative team read confirms a changed binding revision, then resets the original keyed child', async () => {
    await mountWorkflow()
    compose()
    act(() => change('hive-workflow-name', 'Private workflow draft'))
    const name = field('hive-workflow-name'),
      title = field('hive-workflow-case-title'),
      requirement = field('hive-workflow-case-requirement')
    const changedProject = { ...project, binding: { ...project.binding, bindingRevision: 2 } }
    const changedTeam = workbenchTeam(company, changedProject, true)
    const updated = deferredWorkbenchValue<HiveWorkbenchTeam>()
    api.listProjects.mockResolvedValueOnce({
      items: [changedProject, otherProject],
      nextCursor: null
    })
    api.getTeam.mockReturnValueOnce(updated.promise)
    await refresh()
    assertDrafts(name, title, requirement)
    await act(async () => updated.resolve(changedTeam))
    expect(container.querySelector('#hive-workflow-name')).toBeNull()
    expect(container.querySelector('#hive-workflow-case-title')).toBeNull()
    expect(container.textContent).not.toContain('Private detailed acceptance criteria')
    expect(api.listWorkflows).toHaveBeenCalledTimes(2)
  })
})
