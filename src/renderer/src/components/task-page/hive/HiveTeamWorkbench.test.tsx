// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import type { HiveWorkbenchCompanyPage } from '../../../../../shared/hive-team-workbench'
import { HiveTeamWorkbench } from './HiveTeamWorkbench'
import {
  deferredWorkbenchValue,
  workbenchAccountState,
  workbenchCompany,
  workbenchProject,
  workbenchTeam
} from './hive-workbench.test-fixtures'

const workspaces = vi.hoisted(() => ({
  folders: [
    {
      id: 'local',
      name: 'Local folder',
      executionHostId: 'local',
      connectionId: null,
      isArchived: false
    },
    {
      id: 'ssh',
      name: 'SSH folder',
      executionHostId: 'remote:one',
      connectionId: 'ssh:one',
      isArchived: false
    },
    {
      id: 'archived',
      name: 'Archived folder',
      executionHostId: 'local',
      connectionId: null,
      isArchived: true
    }
  ],
  worktrees: [
    {
      id: 'local-worktree',
      displayName: 'Local worktree',
      branch: 'main',
      path: '/local',
      hostId: 'local',
      isArchived: false
    },
    {
      id: 'remote-worktree',
      displayName: 'Remote worktree',
      branch: 'main',
      path: '/remote',
      hostId: 'remote:one',
      isArchived: false
    }
  ],
  openSpacePage: vi.fn(),
  savedToast: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: (
    select: (state: {
      folderWorkspaces: typeof workspaces.folders
      openSpacePage: typeof workspaces.openSpacePage
    }) => unknown
  ) => select({ folderWorkspaces: workspaces.folders, openSpacePage: workspaces.openSpacePage })
}))
vi.mock('@/store/selectors', () => ({ useAllWorktrees: () => workspaces.worktrees }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { success: workspaces.savedToast } }))
vi.mock('./HiveTaskDialog', () => ({
  HiveTaskDialog: ({ label }: { label: string }) => <button type="button">{label}</button>
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
const project = workbenchProject(3, company)
const team = workbenchTeam(company, project, true)
const api = {
  listCompanies: vi.fn(),
  createCompany: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getTeam: vi.fn(),
  configureTeam: vi.fn()
}
let root: Root
let container: HTMLDivElement
let accountChanged: () => void
let accountStateChanged: (state: HiveAccountState) => void
const firstAccount = workbenchAccountState()
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  workspaces.openSpacePage.mockClear()
  workspaces.savedToast.mockClear()
  api.listCompanies.mockResolvedValue({ items: [company], nextCursor: null })
  api.listProjects.mockResolvedValue({ items: [project], nextCursor: null })
  api.getTeam.mockResolvedValue(team)
  api.configureTeam.mockResolvedValue(team)
  api.createProject.mockResolvedValue(project)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveTasks: api,
      hiveAccount: {
        getState: vi.fn().mockResolvedValue(firstAccount),
        onStateChanged: (listener: (state: HiveAccountState) => void) => {
          accountStateChanged = listener
          accountChanged = () => listener(workbenchAccountState('other-owner', 'other-authority'))
          return () => undefined
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
    root.render(<HiveTeamWorkbench />)
  })
}
function button(label: string) {
  const result = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label
  )
  if (!result) {
    throw new Error(`Missing button ${label}`)
  }
  return result
}
function setInput(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)
  if (!input) {
    throw new Error(`Missing input ${id}`)
  }
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('team-workbench forms and availability', () => {
  it('keeps company, project and employee drafts mounted during token refresh failures and recovery', async () => {
    await mount()
    act(() => button('hiveWorkbench.newCompany').click())
    act(() => button('hiveWorkbench.newProject').click())
    act(() => {
      setInput('hive-company-name', 'Company draft')
      setInput('hive-project-name', 'Project draft')
      setInput('hive-employee-product', 'Employee draft')
    })
    const companyInput = container.querySelector('#hive-company-name')
    const projectInput = container.querySelector('#hive-project-name')
    const employeeInput = container.querySelector('#hive-employee-product')
    for (const account of [
      { ...firstAccount, expiresAt: firstAccount.expiresAt! + 10_000 },
      { ...firstAccount, expiresAt: Date.now() - 1000, errorCode: 'network_unavailable' as const },
      { ...firstAccount, expiresAt: Date.now() + 60_000 }
    ]) {
      await act(async () => accountStateChanged(account))
      expect(container.querySelector('#hive-company-name')).toBe(companyInput)
      expect(container.querySelector('#hive-project-name')).toBe(projectInput)
      expect(container.querySelector('#hive-employee-product')).toBe(employeeInput)
      expect(container.querySelector<HTMLInputElement>('#hive-company-name')?.value).toBe(
        'Company draft'
      )
      expect(container.querySelector<HTMLInputElement>('#hive-project-name')?.value).toBe(
        'Project draft'
      )
      expect(container.querySelector<HTMLInputElement>('#hive-employee-product')?.value).toBe(
        'Employee draft'
      )
    }
  })
  it('renders the four real employees, personal task entry and unavailable execution state', async () => {
    await mount()
    expect(button('hiveWorkbench.personalTasks')).not.toBeNull()
    expect(container.querySelector<HTMLInputElement>('#hive-employee-product')?.value).toBe(
      'Private product'
    )
    expect(container.querySelectorAll('input[id^="hive-employee-"]')).toHaveLength(4)
    expect(container.textContent).toContain('hiveWorkbench.executionUnavailable')
    expect(api.configureTeam).not.toHaveBeenCalled()
  })
  it('distinguishes unsupported client access from an invalid workspace on the initial request', async () => {
    api.listCompanies.mockRejectedValue(new Error('CAPABILITY_UNAVAILABLE'))
    await mount()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'hiveWorkbench.clientUnavailable'
    )
    expect(container.textContent).not.toContain('hiveWorkbench.invalidWorkspace')
  })
  it('offers only current local folder and worktree choices and rejects an arbitrary selector', async () => {
    await mount()
    act(() => button('hiveWorkbench.newProject').click())
    const picker = container.querySelector<HTMLSelectElement>('#hive-project-workspace')!
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      '',
      'Local folder',
      'Local worktree'
    ])
    act(() => {
      setInput('hive-project-name', 'New project')
      picker.value = 'E:/arbitrary'
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      picker
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(api.createProject).not.toHaveBeenCalled()
    await act(async () => {
      picker.value = 'folder:local'
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      picker
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(api.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New project',
        companyId: company.id,
        workspaceSelector: 'folder:local'
      })
    )
  })
  it('clears private drafts on account change while a fresh account request is pending', async () => {
    await mount()
    act(() => button('hiveWorkbench.newCompany').click())
    act(() => setInput('hive-company-name', 'Private draft'))
    const fresh = deferredWorkbenchValue<HiveWorkbenchCompanyPage>()
    api.listCompanies.mockReturnValueOnce(fresh.promise)
    act(() => accountChanged())
    expect(container.querySelector('#hive-company-name')).toBeNull()
    expect(container.querySelector('#hive-employee-product')).toBeNull()
    await act(async () => {
      fresh.resolve({ items: [company], nextCursor: null })
    })
    act(() => button('hiveWorkbench.newCompany').click())
    expect(container.querySelector<HTMLInputElement>('#hive-company-name')?.value).toBe('')
  })
  it.each([
    ['hive_agent_forbidden', 'hiveWorkbench.invalidWorkspace'],
    ['selector_not_found', 'hiveWorkbench.invalidWorkspace'],
    ['FORBIDDEN', 'hiveWorkbench.signIn'],
    ['SERVICE_UNAVAILABLE', 'hiveWorkbench.unavailable']
  ])('explains project creation refusal %s', async (error, key) => {
    api.createProject.mockRejectedValue(new Error(error))
    await mount()
    act(() => button('hiveWorkbench.newProject').click())
    const picker = container.querySelector<HTMLSelectElement>('#hive-project-workspace')!
    act(() => {
      setInput('hive-project-name', 'New project')
      picker.value = 'folder:local'
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      picker
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(api.createProject).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(key)
    expect(container.querySelector<HTMLInputElement>('#hive-project-name')?.value).toBe(
      'New project'
    )
    expect(workspaces.savedToast).not.toHaveBeenCalled()
  })
  it('saves four separate roles with the current binding revision and only confirms the real response', async () => {
    await mount()
    const form = container.querySelector('#hive-employee-product')!.closest('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(api.configureTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.id,
        expectedRevision: 1,
        employees: expect.arrayContaining([
          expect.objectContaining({
            role: 'product',
            profileRef: 'codex',
            name: 'Private product'
          }),
          expect.objectContaining({ role: 'tester', profileRef: 'codex', name: 'Private tester' })
        ])
      })
    )
    expect(api.configureTeam.mock.calls[0][0].employees).toHaveLength(4)
    expect(workspaces.savedToast).toHaveBeenCalledWith('hiveWorkbench.teamSaved')
  })
})
