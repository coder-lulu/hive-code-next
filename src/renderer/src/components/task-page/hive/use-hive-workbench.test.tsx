// @vitest-environment happy-dom
import { act, type ReactElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HiveWorkbenchCompanyPage,
  HiveWorkbenchProjectPage,
  HiveWorkbenchTeam
} from '../../../../../shared/hive-team-workbench'
import { useHiveWorkbench } from './use-hive-workbench'
import {
  deferredWorkbenchValue,
  workbenchCompany,
  workbenchId,
  workbenchProject,
  workbenchTeam
} from './hive-workbench.test-fixtures'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
let current: ReturnType<typeof useHiveWorkbench>
let accountChanged: () => void
const unsubscribe = vi.fn()
const api = {
  listCompanies: vi.fn(),
  createCompany: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getTeam: vi.fn(),
  configureTeam: vi.fn()
}
const firstCompany = workbenchCompany(1)
const secondCompany = workbenchCompany(2)
const firstProject = workbenchProject(3, firstCompany)
const secondProject = workbenchProject(4, secondCompany)
const firstTeam = workbenchTeam(firstCompany, firstProject, true)
const secondTeam = workbenchTeam(secondCompany, secondProject)

function Harness(): ReactElement {
  current = useHiveWorkbench()
  return (
    <p>
      {current.selectedCompany?.name}
      {current.selectedProject?.name}
      {current.team?.employees.map((employee) => employee.name).join(',')}
    </p>
  )
}
async function mount(strict = false) {
  await act(async () => {
    root.render(
      strict ? (
        <StrictMode>
          <Harness />
        </StrictMode>
      ) : (
        <Harness />
      )
    )
  })
}
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  unsubscribe.mockReset()
  api.listCompanies.mockResolvedValue({ items: [firstCompany], nextCursor: null })
  api.listProjects.mockImplementation(({ companyId }: { companyId: string }) =>
    Promise.resolve({
      items: [companyId === firstCompany.id ? firstProject : secondProject],
      nextCursor: null
    })
  )
  api.getTeam.mockImplementation((id: string) =>
    Promise.resolve(id === firstProject.id ? firstTeam : secondTeam)
  )
  api.createCompany.mockResolvedValue(secondCompany)
  api.createProject.mockResolvedValue(firstProject)
  api.configureTeam.mockResolvedValue(firstTeam)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveTasks: api,
      hiveAccount: {
        onStateChanged: (listener: () => void) => {
          accountChanged = listener
          return unsubscribe
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

describe('Hive workbench request and account boundaries', () => {
  it('loads the real selected company, its projects and its employees without launching a task', async () => {
    await mount()
    expect(current.team).toEqual(firstTeam)
    expect(api.listProjects).toHaveBeenCalledWith({ companyId: firstCompany.id, after: undefined })
    expect(api.getTeam).toHaveBeenCalledWith(firstProject.id)
    expect(api.createProject).not.toHaveBeenCalled()
    expect(api.configureTeam).not.toHaveBeenCalled()
  })
  it('does not fetch project or team data when no company exists', async () => {
    api.listCompanies.mockResolvedValue({ items: [], nextCursor: null })
    await mount()
    expect(current.companies.items).toEqual([])
    expect(current.busy).toBe(false)
    expect(api.listProjects).not.toHaveBeenCalled()
    expect(api.getTeam).not.toHaveBeenCalled()
  })
  it('keeps synchronous bridge errors in an explicit unavailable state', async () => {
    api.listCompanies.mockImplementation(() => {
      throw new Error('SERVICE_UNAVAILABLE')
    })
    await mount()
    expect(current.error).toBe('SERVICE_UNAVAILABLE')
    expect(current.busy).toBe(false)
  })
  it('discards an old company page after an account change', async () => {
    const old = deferredWorkbenchValue<HiveWorkbenchCompanyPage>()
    const fresh = deferredWorkbenchValue<HiveWorkbenchCompanyPage>()
    api.listCompanies.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    await mount()
    act(() => accountChanged())
    expect(current.companies.items).toEqual([])
    await act(async () => {
      old.resolve({ items: [firstCompany], nextCursor: null })
    })
    expect(current.companies.items).toEqual([])
    expect(current.pending).toBe('companies')
    await act(async () => {
      fresh.resolve({ items: [secondCompany], nextCursor: null })
    })
    expect(current.selectedCompany).toEqual(secondCompany)
    expect(current.team).toEqual(secondTeam)
  })
  it('clears private team data immediately and ignores an old failure while the next account loads', async () => {
    await mount()
    const old = deferredWorkbenchValue<HiveWorkbenchTeam>()
    const fresh = deferredWorkbenchValue<HiveWorkbenchCompanyPage>()
    api.getTeam.mockReturnValueOnce(old.promise)
    let oldRequest!: Promise<boolean>
    await act(async () => {
      oldRequest = current.retryTeam()
    })
    api.listCompanies.mockReturnValueOnce(fresh.promise)
    act(() => accountChanged())
    expect(container.textContent).not.toContain('Private')
    expect(current.team).toBeNull()
    await act(async () => {
      old.reject(new Error('OLD_FAILURE'))
      await oldRequest
    })
    expect(current.error).toBeNull()
    expect(current.pending).toBe('companies')
    await act(async () => {
      fresh.resolve({ items: [secondCompany], nextCursor: null })
    })
    expect(current.team).toEqual(secondTeam)
  })
  it('discards projects from a company that is no longer selected', async () => {
    const old = deferredWorkbenchValue<HiveWorkbenchProjectPage>()
    api.listCompanies.mockResolvedValue({ items: [firstCompany, secondCompany], nextCursor: null })
    api.listProjects.mockReturnValueOnce(old.promise)
    await mount()
    await act(async () => {
      current.selectCompany(secondCompany.id)
    })
    expect(current.team).toEqual(secondTeam)
    await act(async () => {
      old.resolve({ items: [firstProject], nextCursor: null })
    })
    expect(current.selectedCompany?.id).toBe(secondCompany.id)
    expect(current.projects.items).toEqual([secondProject])
    expect(current.team).toEqual(secondTeam)
  })
  it('does not start a queued mutation after the account changes in the same tick', async () => {
    await mount()
    let mutation!: Promise<boolean>
    await act(async () => {
      mutation = current.createCompany({ name: 'Private draft' })
      accountChanged()
      await mutation
    })
    expect(api.createCompany).not.toHaveBeenCalled()
  })
  it('discards a late response after unmount and unsubscribes the account listener', async () => {
    const pending = deferredWorkbenchValue<HiveWorkbenchCompanyPage>()
    api.listCompanies.mockReturnValueOnce(pending.promise)
    await mount()
    act(() => root.unmount())
    await act(async () => {
      pending.resolve({ items: [firstCompany], nextCursor: null })
    })
    expect(current.companies.items).toEqual([])
    expect(api.listProjects).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('starts only the surviving initial request during StrictMode remount', async () => {
    await mount(true)
    expect(api.listCompanies).toHaveBeenCalledOnce()
    expect(current.team).toEqual(firstTeam)
  })
})

describe('Hive workbench pagination and mutations', () => {
  it('loads additional companies by cursor without changing the active project', async () => {
    api.listCompanies
      .mockResolvedValueOnce({ items: [firstCompany], nextCursor: firstCompany.id })
      .mockResolvedValueOnce({ items: [firstCompany, secondCompany], nextCursor: null })
    await mount()
    await act(async () => {
      await current.loadMoreCompanies()
    })
    expect(api.listCompanies).toHaveBeenLastCalledWith({ after: firstCompany.id })
    expect(current.companies.items).toEqual([firstCompany, secondCompany])
    expect(current.team).toEqual(firstTeam)
    expect(api.getTeam).toHaveBeenCalledOnce()
  })
  it('preserves a failed project-page cursor and its current rows for retry', async () => {
    const extra = workbenchProject(5, firstCompany)
    api.listProjects
      .mockResolvedValueOnce({ items: [firstProject], nextCursor: firstProject.id })
      .mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce({ items: [firstProject, extra], nextCursor: null })
    await mount()
    await act(async () => {
      await current.loadMoreProjects()
    })
    expect(current.error).toBe('SERVICE_UNAVAILABLE')
    expect(current.projects).toEqual({ items: [firstProject], nextCursor: firstProject.id })
    await act(async () => {
      await current.loadMoreProjects()
    })
    expect(api.listProjects).toHaveBeenLastCalledWith({
      companyId: firstCompany.id,
      after: firstProject.id
    })
    expect(current.projects.items).toEqual([firstProject, extra])
    expect(current.projectId).toBe(firstProject.id)
    expect(current.error).toBeNull()
  })
  it('prevents concurrent writes and keeps a failed identical company request id for retry', async () => {
    const pending = deferredWorkbenchValue<typeof secondCompany>()
    api.createCompany.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(secondCompany)
    await mount()
    let first!: Promise<boolean>
    let concurrent!: Promise<boolean>
    await act(async () => {
      first = current.createCompany({ name: ' Company ' })
      concurrent = current.createCompany({ name: 'Company' })
    })
    expect(await concurrent).toBe(false)
    expect(api.createCompany).toHaveBeenCalledOnce()
    await act(async () => {
      pending.reject(new Error('SERVICE_UNAVAILABLE'))
      await first
    })
    const originalId = api.createCompany.mock.calls[0][0].requestId
    await act(async () => {
      await current.createCompany({ name: 'Company' })
    })
    expect(api.createCompany.mock.calls[1][0]).toEqual({ name: 'Company', requestId: originalId })
    expect(current.selectedCompany).toEqual(secondCompany)
  })
  it('gives changed project input a fresh id and retains retry ids for each unchanged input', async () => {
    api.createProject.mockRejectedValue(new Error('SERVICE_UNAVAILABLE'))
    await mount()
    const input = { companyId: firstCompany.id, name: 'Project', workspaceSelector: 'folder:local' }
    await act(async () => {
      await current.createProject(input)
      await current.createProject(input)
    })
    const firstId = api.createProject.mock.calls[0][0].requestId
    expect(api.createProject.mock.calls[1][0].requestId).toBe(firstId)
    await act(async () => {
      await current.createProject({ ...input, workspaceSelector: 'folder:other' })
    })
    expect(api.createProject.mock.calls[2][0].requestId).not.toBe(firstId)
  })
  it('applies a returned employee revision and retains the exact retry key after a failed save', async () => {
    const changedProject = {
      ...firstProject,
      binding: { ...firstProject.binding, bindingRevision: 2 }
    }
    const changedTeam = workbenchTeam(firstCompany, changedProject, true)
    api.configureTeam
      .mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce(changedTeam)
    await mount()
    const input = {
      projectId: firstProject.id,
      expectedRevision: 1,
      employees: firstTeam.employees.map((employee) => ({
        role: employee.binding.role,
        name: employee.name,
        profileRef: 'codex' as const,
        profileRevision: 'codex:1' as const
      }))
    }
    await act(async () => {
      await current.configureTeam(input)
      await current.configureTeam(input)
    })
    expect(api.configureTeam.mock.calls[0][0].requestId).toBe(
      api.configureTeam.mock.calls[1][0].requestId
    )
    expect(current.team).toEqual(changedTeam)
    expect(current.selectedProject?.binding.bindingRevision).toBe(2)
  })
  it('does not reuse a failed mutation key after the account changes', async () => {
    api.createCompany.mockRejectedValue(new Error('SERVICE_UNAVAILABLE'))
    await mount()
    await act(async () => {
      await current.createCompany({ name: 'Same input' })
    })
    const firstId = api.createCompany.mock.calls[0][0].requestId
    await act(async () => {
      accountChanged()
    })
    await act(async () => {
      await current.createCompany({ name: 'Same input' })
    })
    expect(api.createCompany.mock.calls[1][0].requestId).not.toBe(firstId)
  })
  it('ignores selectors that were not returned by the current authorized list', async () => {
    await mount()
    act(() => {
      current.selectCompany(workbenchId(999))
      current.selectProject(workbenchId(999))
    })
    expect(current.team).toEqual(firstTeam)
    expect(api.listProjects).toHaveBeenCalledOnce()
    expect(api.getTeam).toHaveBeenCalledOnce()
  })
})
