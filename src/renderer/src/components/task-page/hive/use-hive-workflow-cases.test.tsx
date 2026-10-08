// @vitest-environment happy-dom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import type { HiveWorkflowSnapshot } from '../../../../../shared/hive-task-workflows'
import {
  HiveWorkflowCaseCreateSchema,
  type HiveWorkflowCaseCreate,
  type HiveWorkflowCasePage,
  type HiveWorkflowCaseView
} from '../../../../../shared/hive-workflow-cases'
import { useHiveWorkflowCases } from './use-hive-workflow-cases'
import {
  deferredWorkbenchValue,
  workbenchAccountState,
  workbenchAccountRefreshStates,
  workbenchAccountBoundaryStates,
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
let current: ReturnType<typeof useHiveWorkflowCases>
function Harness({
  currentTeam,
  currentWorkflow,
  blocked
}: {
  currentTeam: HiveWorkbenchTeam
  currentWorkflow: HiveWorkflowSnapshot
  blocked: boolean
}) {
  current = useHiveWorkflowCases(currentTeam, currentWorkflow, blocked)
  return (
    <p>
      {current.draft?.title}
      {current.view?.requirement}
    </p>
  )
}
async function mount(
  currentTeam = team,
  currentWorkflow = workflow,
  account = 1,
  blocked = false,
  strict = false
) {
  const element = (
    <Harness
      key={`${account}:${currentTeam.project.id}:${currentWorkflow.workflowId}`}
      currentTeam={currentTeam}
      currentWorkflow={currentWorkflow}
      blocked={blocked}
    />
  )
  await act(async () => {
    root.render(strict ? <StrictMode>{element}</StrictMode> : element)
  })
}
function compose() {
  act(() => current.begin())
  act(() => current.edit({ title: 'Feature request', requirement: 'Private requirement text' }))
}
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  listeners.clear()
  accountGetState.mockReset().mockResolvedValue(firstAccount)
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

describe('workflow request receipts and scope boundaries', () => {
  it('keeps selected detail, the private draft, pending create and retry ID across account refreshes', async () => {
    const view = workflowCaseView(team, workflow)
    api.listWorkflowCases.mockResolvedValue({
      items: [workflowCaseSummary(view)],
      nextCursor: null
    })
    api.getWorkflowCase.mockResolvedValue(view)
    await mount()
    await act(async () => {
      await current.select(view.id)
    })
    compose()
    const draft = current.draft
    const pending = deferredWorkbenchValue<HiveWorkflowCaseView>()
    api.createWorkflowCase.mockReturnValueOnce(pending.promise)
    let result!: Promise<boolean>
    await act(async () => {
      result = current.create()
    })
    const first: HiveWorkflowCaseCreate = api.createWorkflowCase.mock.calls[0][0]
    for (const account of workbenchAccountRefreshStates(firstAccount)) {
      await act(async () => accountStateChanged(account))
      expect(current.pending).toBe('create')
      expect(current.accountAvailable).toBe(true)
      expect(current.canCreate).toBe(true)
      expect(current.view).toEqual(view)
      expect(current.items).toEqual([workflowCaseSummary(view)])
      expect(current.draft).toEqual(draft)
      await act(async () => {
        expect(await current.create()).toBe(false)
        expect(await current.refresh()).toBe(false)
      })
    }
    expect(api.createWorkflowCase).toHaveBeenCalledOnce()
    expect(api.listWorkflowCases).toHaveBeenCalledOnce()
    await act(async () => {
      pending.reject(new Error('SERVICE_UNAVAILABLE'))
      await result
    })
    expect(await result).toBe(false)
    await act(async () => {
      expect(await current.create()).toBe(true)
    })
    expect(api.createWorkflowCase.mock.calls[1][0].requestId).toBe(first.requestId)
    expect(current.view?.requirement).toBe('Private requirement text')
  })
  it('starts one queued create across a same-account notification in the same tick', async () => {
    await mount()
    compose()
    await act(async () => {
      const first = current.create()
      accountStateChanged(workbenchAccountRefreshStates(firstAccount)[0])
      expect(await current.create()).toBe(false)
      expect(await first).toBe(true)
    })
    expect(api.createWorkflowCase).toHaveBeenCalledOnce()
    expect(current.view?.requirement).toBe('Private requirement text')
  })
  it.each(workbenchAccountBoundaryStates(firstAccount))(
    'clears case drafts and rejects a late creation at the $name boundary',
    async ({ state: account }) => {
      const view = workflowCaseView(team, workflow)
      api.listWorkflowCases.mockResolvedValue({
        items: [workflowCaseSummary(view)],
        nextCursor: null
      })
      api.getWorkflowCase.mockResolvedValue(view)
      await mount()
      await act(async () => {
        await current.select(view.id)
      })
      compose()
      const pending = deferredWorkbenchValue<HiveWorkflowCaseView>()
      api.createWorkflowCase.mockReturnValueOnce(pending.promise)
      let result!: Promise<boolean>
      await act(async () => {
        result = current.create()
      })
      const input: HiveWorkflowCaseCreate = api.createWorkflowCase.mock.calls[0][0]
      await act(async () => accountStateChanged(account))
      expect(current.draft).toBeNull()
      expect(current.view).toBeNull()
      expect(current.items).toEqual([])
      expect(current.pending).toBeNull()
      expect(current.accountAvailable).toBe(false)
      expect(current.canCreate).toBe(false)
      await act(async () => {
        pending.resolve(submittedWorkflowCase(input, team, workflow))
        await result
        expect(await current.create()).toBe(false)
        expect(await current.refresh()).toBe(false)
      })
      expect(await result).toBe(false)
      expect(current.view).toBeNull()
      expect(api.listWorkflowCases).toHaveBeenCalledOnce()
    }
  )
  it('projects only summary fields from a verified creation and keeps full text in detail', async () => {
    await mount()
    compose()
    await act(async () => {
      expect(await current.create()).toBe(true)
    })
    expect(current.view?.requirement).toBe('Private requirement text')
    expect(current.items).toHaveLength(1)
    for (const field of ['requirement', 'workflow', 'team', 'stageTasks']) {
      expect(Object.keys(current.items[0])).not.toContain(field)
    }
    expect(current.draft).toBeNull()
  })
  it('does not start a queued create after the account notification in the same tick', async () => {
    await mount()
    compose()
    let result!: Promise<boolean>
    await act(async () => {
      result = current.create()
      accountStateChanged(secondAccount)
      await result
    })
    expect(await result).toBe(false)
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
    expect(current.draft).toBeNull()
    expect(current.accountAvailable).toBe(false)
    expect(current.view).toBeNull()
  })
  it('runs only the surviving initial list during StrictMode and retains one account listener', async () => {
    await mount(team, workflow, 1, false, true)
    expect(api.listWorkflowCases).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(1)
  })
  it('does not clear a failed create draft while refreshing the list', async () => {
    await mount()
    compose()
    api.createWorkflowCase.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await act(async () => {
      await current.create()
    })
    const draft = current.draft
    await act(async () => {
      await current.refresh()
    })
    expect(current.draft).toEqual(draft)
    expect(current.view).toBeNull()
    await act(async () => {
      await current.create()
    })
    expect(api.createWorkflowCase.mock.calls[1][0].requestId).toBe(
      api.createWorkflowCase.mock.calls[0][0].requestId
    )
  })

  it('retains a selected later-page Case and its newer phase while refreshing the first page', async () => {
    const first = workflowCaseView(team, workflow)
    const selected = workflowCaseView(team, workflow, 201)
    const moved = {
      ...selected,
      revision: 2,
      currentStageRef: selected.workflow.definition.stages.find(
        (stage) => stage.role === 'developer'
      )!.stageRef
    }
    const initial = { items: [workflowCaseSummary(first)], nextCursor: first.id }
    api.listWorkflowCases
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({
        items: [workflowCaseSummary(selected)],
        nextCursor: null
      })
      .mockResolvedValueOnce(initial)
    api.getWorkflowCase.mockResolvedValue(moved)
    await mount()
    await act(async () => {
      expect(await current.loadMore()).toBe(true)
    })
    await act(async () => {
      expect(await current.select(selected.id)).toBe(true)
    })
    await act(async () => {
      expect(await current.refresh()).toBe(true)
    })
    expect(current.view).toEqual(moved)
    expect(current.items.find((item) => item.id === selected.id)).toEqual(
      workflowCaseSummary(moved)
    )
    expect(current.items.find((item) => item.id === selected.id)?.currentStageRole).toBe(
      'developer'
    )
    expect(current.nextCursor).toBe(first.id)
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
  })
  it('uses a different idempotency request after the current saved version changes', async () => {
    await mount()
    compose()
    api.createWorkflowCase.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await act(async () => {
      await current.create()
    })
    const first: HiveWorkflowCaseCreate = api.createWorkflowCase.mock.calls[0][0]
    const newer = workflowSnapshot(team, 2)
    api.createWorkflowCase.mockImplementation((input: HiveWorkflowCaseCreate) =>
      Promise.resolve(submittedWorkflowCase(input, team, newer))
    )
    await mount(team, newer)
    expect(current.draft?.title).toBe('Feature request')
    await act(async () => {
      expect(await current.create()).toBe(true)
    })
    expect(api.createWorkflowCase.mock.calls[1][0]).toMatchObject({
      workflowRevision: 2,
      definitionDigest: newer.definitionDigest
    })
    expect(api.createWorkflowCase.mock.calls[1][0].requestId).not.toBe(first.requestId)
    expect(api.listWorkflowCases).toHaveBeenCalledOnce()
  })
  it('recovers the current case after a lost receipt and a business content update', async () => {
    await mount()
    compose()
    api.createWorkflowCase.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await act(async () => {
      expect(await current.create()).toBe(false)
    })
    const first = HiveWorkflowCaseCreateSchema.parse(api.createWorkflowCase.mock.calls[0][0])
    const recovered = submittedWorkflowCase(first, team, workflow)
    recovered.title = 'Updated feature request'
    recovered.requirement = 'Updated business requirements'
    recovered.revision = 2
    api.createWorkflowCase.mockResolvedValueOnce(recovered)
    await act(async () => {
      expect(await current.create()).toBe(true)
    })
    expect(api.createWorkflowCase.mock.calls[1][0]).toEqual(first)
    expect(current.view).toEqual(recovered)
    expect(current.items).toEqual([workflowCaseSummary(recovered)])
    expect(current.draft).toBeNull()
    expect(current.error).toBeNull()
  })
  it.each([
    { name: 'CJK', requirement: '需'.repeat(48_000) },
    { name: 'JSON escaped characters', requirement: '\u0001'.repeat(48_000) },
    { name: 'emoji', requirement: '😀'.repeat(24_000) }
  ])('submits a valid maximum length $name requirement', async ({ requirement }) => {
    await mount()
    compose()
    act(() => current.edit({ requirement }))
    await act(async () => {
      expect(await current.create()).toBe(true)
    })
    expect(api.createWorkflowCase).toHaveBeenCalledOnce()
    expect(api.createWorkflowCase.mock.calls[0][0].requirement).toBe(requirement)
    expect(current.view?.requirement).toBe(requirement)
    expect(current.draft).toBeNull()
  })
  it('keeps the character limit before sending an oversized requirement', async () => {
    await mount()
    compose()
    act(() => current.edit({ requirement: '需'.repeat(48_001) }))
    await act(async () => {
      expect(await current.create()).toBe(false)
    })
    expect(api.createWorkflowCase).not.toHaveBeenCalled()
    expect(current.draft?.requirement).toHaveLength(48_001)
    expect(current.error).toBe('INVALID_REQUEST')
  })
  it('blocks creation when the definition is being edited while allowing existing detail reads', async () => {
    const view = workflowCaseView(team, workflow)
    api.listWorkflowCases.mockResolvedValue({
      items: [workflowCaseSummary(view)],
      nextCursor: null
    })
    api.getWorkflowCase.mockResolvedValue(view)
    await mount(team, workflow, 1, true)
    expect(current.canCreate).toBe(false)
    act(() => current.begin())
    expect(current.draft).toBeNull()
    await act(async () => {
      expect(await current.select(view.id)).toBe(true)
    })
    expect(current.view).toEqual(view)
  })
  it('retains the previous verified detail after a failed read and never displays unverified content', async () => {
    const one = workflowCaseView(team, workflow)
    const two = workflowCaseView(team, workflow, 201, 'Second request', 'Second private text')
    api.listWorkflowCases.mockResolvedValue({
      items: [workflowCaseSummary(one), workflowCaseSummary(two)],
      nextCursor: null
    })
    api.getWorkflowCase
      .mockResolvedValueOnce(one)
      .mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await mount()
    await act(async () => {
      await current.select(one.id)
    })
    await act(async () => {
      expect(await current.select(two.id)).toBe(false)
    })
    expect(current.view).toEqual(one)
    expect(container.textContent).not.toContain(two.requirement)
    expect(current.error).toBe('SERVICE_UNAVAILABLE')
  })
  it.each(['wrong-id', 'scope', 'owner', 'digest', 'employee', 'terminal'])(
    'rejects an invalid %s detail',
    async (kind) => {
      const expected = workflowCaseView(team, workflow)
      const received = workflowCaseView(
        kind === 'scope' ? secondTeam : team,
        kind === 'scope' ? secondWorkflow : workflow,
        kind === 'wrong-id' ? 201 : 200
      )
      if (kind === 'owner') {
        received.team.company.ownerAccountRef = 'account:someone-else'
      }
      if (kind === 'digest') {
        received.workflow.definitionDigest = '0'.repeat(64)
      }
      if (kind === 'employee') {
        received.stageTasks[0].employeeRef = company.id
      }
      if (kind === 'terminal') {
        received.terminalKind = 'done'
        received.currentStageRef = null
      }
      api.listWorkflowCases.mockResolvedValue({
        items: [workflowCaseSummary(expected)],
        nextCursor: null
      })
      api.getWorkflowCase.mockResolvedValue(received)
      await mount()
      await act(async () => {
        expect(await current.select(expected.id)).toBe(false)
      })
      expect(current.view).toBeNull()
      expect(current.error).toBe(
        kind === 'scope' || kind === 'owner' ? 'FORBIDDEN' : 'INVALID_RESPONSE'
      )
    }
  )
  it.each(['case-id', 'terminal', 'cursor', 'duplicates', 'oversized'])(
    'rejects an invalid %s page',
    async (kind) => {
      const view = workflowCaseView(team, workflow)
      const summary = workflowCaseSummary(view)
      const page: HiveWorkflowCasePage = { items: [summary], nextCursor: null }
      if (kind === 'case-id') {
        summary.binding.workflowRunRef = company.id
      }
      if (kind === 'terminal') {
        summary.terminalKind = 'cancelled'
      }
      if (kind === 'cursor') {
        page.nextCursor = workflow.workflowId
      }
      if (kind === 'duplicates') {
        page.items.push(summary)
      }
      if (kind === 'oversized') {
        page.items = Array.from({ length: 26 }, (_, index) =>
          workflowCaseSummary(workflowCaseView(team, workflow, 200 + index))
        )
      }
      api.listWorkflowCases.mockResolvedValue(page)
      await mount()
      expect(current.items).toEqual([])
      expect(current.error).toBe('INVALID_RESPONSE')
    }
  )
  it.each(['revision', 'binding'])(
    'rejects an unrequested created %s without clearing the draft',
    async (kind) => {
      await mount()
      compose()
      api.createWorkflowCase.mockImplementation((input: HiveWorkflowCaseCreate) => {
        if (kind === 'revision') {
          return Promise.resolve(submittedWorkflowCase(input, team, workflowSnapshot(team, 2)))
        }
        const another = structuredClone(team)
        another.project.binding.bindingRevision = 2
        another.employees.forEach((employee) => {
          employee.binding.bindingRevision = 2
        })
        return Promise.resolve(
          submittedWorkflowCase(input, another, { ...workflow, projectBindingRevision: 2 })
        )
      })
      await act(async () => {
        expect(await current.create()).toBe(false)
      })
      expect(current.draft?.title).toBe('Feature request')
      expect(current.view).toBeNull()
      expect(current.error).toBe('INVALID_RESPONSE')
    }
  )
  it('discards a late detail after switching projects', async () => {
    const view = workflowCaseView(team, workflow)
    const pending = deferredWorkbenchValue<HiveWorkflowCaseView>()
    api.listWorkflowCases.mockResolvedValueOnce({
      items: [workflowCaseSummary(view)],
      nextCursor: null
    })
    api.getWorkflowCase.mockReturnValueOnce(pending.promise)
    await mount()
    let result!: Promise<boolean>
    await act(async () => {
      result = current.select(view.id)
    })
    await mount(secondTeam, secondWorkflow)
    await act(async () => {
      pending.resolve(view)
      await result
    })
    expect(await result).toBe(false)
    expect(current.view).toBeNull()
    expect(current.error).toBeNull()
    expect(api.listWorkflowCases).toHaveBeenLastCalledWith({
      projectId: secondTeam.project.id,
      workflowId: secondWorkflow.workflowId,
      after: undefined,
      limit: 25
    })
  })
  it('does not accept an old page after logout and a fresh same-project account mount', async () => {
    const pending = deferredWorkbenchValue<HiveWorkflowCasePage>()
    api.listWorkflowCases.mockReturnValueOnce(pending.promise)
    await mount()
    act(() => accountStateChanged(secondAccount))
    await mount(team, workflow, 2)
    await act(async () => {
      pending.resolve({
        items: [workflowCaseSummary(workflowCaseView(team, workflow))],
        nextCursor: null
      })
    })
    expect(current.items).toEqual([])
    expect(current.view).toBeNull()
    expect(current.pending).toBeNull()
  })
  it('does not start a second operation until the original create has settled', async () => {
    await mount()
    compose()
    const pending = deferredWorkbenchValue<HiveWorkflowCaseView>()
    api.createWorkflowCase.mockReturnValueOnce(pending.promise)
    let result!: Promise<boolean>
    await act(async () => {
      result = current.create()
      expect(await current.refresh()).toBe(false)
    })
    expect(api.listWorkflowCases).toHaveBeenCalledOnce()
    await act(async () => {
      pending.resolve(
        submittedWorkflowCase(api.createWorkflowCase.mock.calls[0][0], team, workflow)
      )
      await result
    })
    expect(await result).toBe(true)
    expect(current.pending).toBeNull()
  })
})
