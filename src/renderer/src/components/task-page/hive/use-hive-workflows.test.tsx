// @vitest-environment happy-dom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import type {
  HiveWorkflowPage,
  HiveWorkflowSave,
  HiveWorkflowSnapshot
} from '../../../../../shared/hive-task-workflows'
import { structuredAgentSessionDigest } from '../../../../../shared/structured-agent-session-mutation'
import { useHiveWorkflows } from './use-hive-workflows'
import {
  deferredWorkbenchValue,
  workbenchAccountState,
  workbenchAccountRefreshStates,
  workbenchAccountBoundaryStates,
  workbenchCompany,
  workbenchProject,
  workbenchTeam
} from './hive-workbench.test-fixtures'
import { savedWorkflow, workflowSnapshot } from './hive-workflow.test-fixtures'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const company = workbenchCompany(1)
const firstTeam = workbenchTeam(company, workbenchProject(3, company), true)
const secondTeam = workbenchTeam(company, workbenchProject(4, company), true)
const api = { listWorkflows: vi.fn(), getWorkflow: vi.fn(), saveWorkflow: vi.fn() }
const firstAccount = workbenchAccountState()
const secondAccount = workbenchAccountState('other-owner', 'other-authority')
const accountGetState = vi.fn<() => Promise<HiveAccountState>>()
const listeners = new Set<(state: HiveAccountState) => void>()
const accountStateChanged = (state: HiveAccountState) =>
  listeners.forEach((listener) => listener(state))
let root: Root
let container: HTMLDivElement
let current: ReturnType<typeof useHiveWorkflows>
function Harness({ team }: { team: HiveWorkbenchTeam }) {
  current = useHiveWorkflows(team)
  return (
    <p>
      {current.draft?.name}
      {current.items.map((item) => item.name).join(',')}
    </p>
  )
}
async function mount(team = firstTeam, account = 1, strict = false) {
  const element = (
    <Harness
      key={`${account}:${team.project.id}:${team.project.binding.bindingRevision}`}
      team={team}
    />
  )
  await act(async () => {
    root.render(strict ? <StrictMode>{element}</StrictMode> : element)
  })
}
async function create() {
  act(() => current.create((key) => key))
}
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  listeners.clear()
  accountGetState.mockReset().mockResolvedValue(firstAccount)
  api.listWorkflows.mockResolvedValue({ items: [], nextCursor: null })
  api.saveWorkflow.mockImplementation((input: HiveWorkflowSave) =>
    Promise.resolve(savedWorkflow(input, firstTeam))
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

describe('workflow editor identity, drafts and saved versions', () => {
  it('keeps the selected workflow, pending save and retry ID through refresh failure and recovery', async () => {
    const snapshot = workflowSnapshot(firstTeam)
    api.listWorkflows.mockResolvedValue({ items: [snapshot], nextCursor: null })
    api.getWorkflow.mockResolvedValue(snapshot)
    await mount()
    await act(async () => {
      await current.select(snapshot.workflowId)
    })
    act(() => current.edit((draft) => ({ ...draft, name: 'Retained private workflow' })))
    const pending = deferredWorkbenchValue<HiveWorkflowSnapshot>()
    api.saveWorkflow.mockReturnValueOnce(pending.promise)
    let result!: Promise<boolean>
    await act(async () => {
      result = current.save()
    })
    const first: HiveWorkflowSave = api.saveWorkflow.mock.calls[0][0]
    for (const account of workbenchAccountRefreshStates(firstAccount)) {
      await act(async () => accountStateChanged(account))
      expect(current.pending).toBe('save')
      expect(current.baseline).toEqual(snapshot)
      expect(current.items).toEqual([snapshot])
      expect(current.draft?.name).toBe('Retained private workflow')
      await act(async () => {
        expect(await current.save()).toBe(false)
        expect(await current.refresh()).toBe(false)
      })
    }
    expect(api.saveWorkflow).toHaveBeenCalledOnce()
    expect(api.listWorkflows).toHaveBeenCalledOnce()
    await act(async () => {
      pending.reject(new Error('SERVICE_UNAVAILABLE'))
      await result
    })
    expect(await result).toBe(false)
    await act(async () => {
      expect(await current.save()).toBe(true)
    })
    expect(api.saveWorkflow.mock.calls[1][0].requestId).toBe(first.requestId)
    expect(current.baseline?.name).toBe('Retained private workflow')
  })
  it('starts one queued save across a same-account notification in the same tick', async () => {
    await mount()
    await create()
    await act(async () => {
      const first = current.save()
      accountStateChanged(workbenchAccountRefreshStates(firstAccount)[0])
      expect(await current.save()).toBe(false)
      expect(await first).toBe(true)
    })
    expect(api.saveWorkflow).toHaveBeenCalledOnce()
    expect(current.baseline).not.toBeNull()
  })
  it.each(workbenchAccountBoundaryStates(firstAccount))(
    'clears workflow drafts and rejects a late save at the $name boundary',
    async ({ state: account }) => {
      const snapshot = workflowSnapshot(firstTeam)
      api.listWorkflows.mockResolvedValue({ items: [snapshot], nextCursor: null })
      api.getWorkflow.mockResolvedValue(snapshot)
      await mount()
      await act(async () => {
        await current.select(snapshot.workflowId)
      })
      act(() => current.edit((draft) => ({ ...draft, name: 'Private pending workflow' })))
      const pending = deferredWorkbenchValue<HiveWorkflowSnapshot>()
      api.saveWorkflow.mockReturnValueOnce(pending.promise)
      let result!: Promise<boolean>
      await act(async () => {
        result = current.save()
      })
      const input: HiveWorkflowSave = api.saveWorkflow.mock.calls[0][0]
      await act(async () => accountStateChanged(account))
      expect(current.draft).toBeNull()
      expect(current.baseline).toBeNull()
      expect(current.items).toEqual([])
      expect(current.pending).toBeNull()
      await act(async () => {
        pending.resolve(savedWorkflow(input, firstTeam))
        await result
        expect(await current.save()).toBe(false)
        expect(await current.refresh()).toBe(false)
      })
      expect(await result).toBe(false)
      expect(current.baseline).toBeNull()
      expect(api.listWorkflows).toHaveBeenCalledOnce()
    }
  )
  it('requests a bounded page in the selected real project and never starts a task', async () => {
    const snapshot = workflowSnapshot(firstTeam)
    api.listWorkflows.mockResolvedValue({ items: [snapshot], nextCursor: null })
    await mount()
    expect(api.listWorkflows).toHaveBeenCalledWith({
      projectId: firstTeam.project.id,
      after: undefined,
      limit: 25
    })
    expect(current.items).toEqual([snapshot])
    expect(current.draft).toBeNull()
    expect(api.saveWorkflow).not.toHaveBeenCalled()
  })
  it('retries a failed list without fabricating an empty successful result', async () => {
    api.listWorkflows.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await mount()
    expect(current.error).toBe('SERVICE_UNAVAILABLE')
    await act(async () => {
      await current.refresh()
    })
    expect(current.error).toBeNull()
    expect(api.listWorkflows).toHaveBeenCalledTimes(2)
  })
  it('follows the bounded cursor and retains earlier pages', async () => {
    const one = workflowSnapshot(firstTeam, 1, 100)
    const two = workflowSnapshot(firstTeam, 1, 101)
    api.listWorkflows
      .mockResolvedValueOnce({ items: [one], nextCursor: one.workflowId })
      .mockResolvedValueOnce({ items: [two], nextCursor: null })
    await mount()
    await act(async () => {
      await current.loadMore()
    })
    expect(current.items).toEqual([one, two])
    expect(api.listWorkflows).toHaveBeenLastCalledWith({
      projectId: firstTeam.project.id,
      after: one.workflowId,
      limit: 25
    })
  })
  it.each(['digest', 'scope', 'binding', 'cursor', 'duplicates', 'oversized'])(
    'rejects an invalid %s page',
    async (kind) => {
      const snapshot = workflowSnapshot(kind === 'scope' ? secondTeam : firstTeam)
      const page: HiveWorkflowPage = { items: [snapshot], nextCursor: null }
      if (kind === 'digest') {
        snapshot.definitionDigest = '0'.repeat(64)
      }
      if (kind === 'binding') {
        snapshot.projectBindingRevision += 1
      }
      if (kind === 'cursor') {
        page.nextCursor = company.id
      }
      if (kind === 'duplicates') {
        page.items.push(snapshot)
      }
      if (kind === 'oversized') {
        page.items = Array.from({ length: 26 }, (_, index) =>
          workflowSnapshot(firstTeam, 1, 100 + index)
        )
      }
      api.listWorkflows.mockResolvedValue(page)
      await mount()
      expect(current.items).toEqual([])
      expect(current.error).toBe(
        kind === 'scope'
          ? 'FORBIDDEN'
          : kind === 'binding'
            ? 'REVISION_CONFLICT'
            : 'INVALID_RESPONSE'
      )
    }
  )
  it('saves the default four-role graph only after the matching actual response', async () => {
    await mount()
    await create()
    expect(current.refusal).toBeNull()
    expect(current.draft?.stages.map((stage) => stage.role)).toEqual([
      'product',
      'developer',
      'tester',
      'ops'
    ])
    let success = false
    await act(async () => {
      success = await current.save()
    })
    expect(success).toBe(true)
    const input: HiveWorkflowSave = api.saveWorkflow.mock.calls[0][0]
    expect(input).toMatchObject({
      projectId: firstTeam.project.id,
      expectedRevision: 0,
      expectedProjectRevision: 1
    })
    expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(input.stages[2].returnToStageRef).toBe(input.stages[1].stageRef)
    expect(current.baseline?.definition.workflowRevision).toBe(1)
    expect(current.dirty).toBe(false)
  })
  it('coalesces same-tick double-submit before the bridge starts', async () => {
    await mount()
    await create()
    const pending = deferredWorkbenchValue<HiveWorkflowSnapshot>()
    api.saveWorkflow.mockReturnValue(pending.promise)
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    await act(async () => {
      first = current.save()
      second = current.save()
    })
    expect(api.saveWorkflow).toHaveBeenCalledOnce()
    expect(current.pending).toBe('save')
    await act(async () => {
      pending.resolve(savedWorkflow(api.saveWorkflow.mock.calls[0][0], firstTeam))
      await first
      await second
    })
    expect(await second).toBe(false)
    expect(current.pending).toBeNull()
  })
  it('retains the draft and reuses the request ID for an unchanged failed save', async () => {
    await mount()
    await create()
    api.saveWorkflow.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await act(async () => {
      await current.save()
    })
    const first: HiveWorkflowSave = api.saveWorkflow.mock.calls[0][0]
    expect(current.draft?.name).toBe('hiveWorkflow.defaultName')
    expect(current.baseline).toBeNull()
    await act(async () => {
      await current.save()
    })
    expect(api.saveWorkflow.mock.calls[1][0].requestId).toBe(first.requestId)
    expect(current.baseline).not.toBeNull()
  })
  it('uses a new request ID after editing a failed draft', async () => {
    await mount()
    await create()
    api.saveWorkflow.mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
    await act(async () => {
      await current.save()
    })
    const first: HiveWorkflowSave = api.saveWorkflow.mock.calls[0][0]
    act(() => current.edit((draft) => ({ ...draft, name: 'Changed delivery' })))
    await act(async () => {
      await current.save()
    })
    expect(api.saveWorkflow.mock.calls[1][0].requestId).not.toBe(first.requestId)
    expect(current.baseline?.name).toBe('Changed delivery')
  })
  it('refuses a dependency cycle and keeps all edited fields', async () => {
    await mount()
    await create()
    act(() =>
      current.edit((draft) => ({
        ...draft,
        name: 'Cycle draft',
        stages: draft.stages.map((stage, index) =>
          index === 0 ? { ...stage, dependsOn: [draft.stages[1].stageRef] } : stage
        )
      }))
    )
    await act(async () => {
      await current.save()
    })
    expect(current.error).toBe('workflow_dependency_cycle')
    expect(current.draft?.name).toBe('Cycle draft')
    expect(api.saveWorkflow).not.toHaveBeenCalled()
  })
  it('preserves edits on version conflict and refreshes only the inventory', async () => {
    const initial = workflowSnapshot(firstTeam)
    const latest = workflowSnapshot(firstTeam, 2)
    api.listWorkflows
      .mockResolvedValueOnce({ items: [initial], nextCursor: null })
      .mockResolvedValueOnce({ items: [latest], nextCursor: null })
    api.getWorkflow.mockResolvedValueOnce(initial).mockResolvedValueOnce(latest)
    await mount()
    await act(async () => {
      await current.select(initial.workflowId)
    })
    act(() => current.edit((draft) => ({ ...draft, name: 'Private revision draft' })))
    api.saveWorkflow.mockRejectedValue(new Error('REVISION_CONFLICT'))
    await act(async () => {
      await current.save()
    })
    expect(current.error).toBe('REVISION_CONFLICT')
    expect(current.baseline).toEqual(initial)
    await act(async () => {
      await current.refresh()
    })
    expect(current.draft?.name).toBe('Private revision draft')
    expect(current.items[0]).toEqual(latest)
    await act(async () => {
      expect(await current.select(initial.workflowId)).toBe(false)
    })
    act(() => current.discard())
    await act(async () => {
      await current.select(initial.workflowId)
    })
    expect(current.baseline).toEqual(latest)
  })
  it('views immutable history without replacing the current inventory or allowing edits', async () => {
    const latest = workflowSnapshot(firstTeam, 2)
    const older = workflowSnapshot(firstTeam, 1)
    api.listWorkflows.mockResolvedValue({ items: [latest], nextCursor: null })
    api.getWorkflow.mockResolvedValue(older)
    await mount()
    await act(async () => {
      await current.select(latest.workflowId, 1)
    })
    expect(current.historical).toBe(true)
    act(() => current.edit((draft) => ({ ...draft, name: 'Historical overwrite' })))
    expect(current.draft?.name).toBe(older.name)
    expect(current.items).toEqual([latest])
    await act(async () => {
      expect(await current.save()).toBe(false)
    })
    expect(api.saveWorkflow).not.toHaveBeenCalled()
  })
  it('rebases a retained draft only after explicitly reviewing the current saved version', async () => {
    const initial = workflowSnapshot(firstTeam)
    const latest = workflowSnapshot(firstTeam, 2, 100, 'Someone else changed this')
    api.listWorkflows.mockResolvedValue({ items: [initial], nextCursor: null })
    api.getWorkflow.mockResolvedValueOnce(initial).mockResolvedValueOnce(latest)
    await mount()
    await act(async () => {
      await current.select(initial.workflowId)
    })
    act(() => current.edit((draft) => ({ ...draft, name: 'Retained draft' })))
    api.saveWorkflow.mockRejectedValueOnce(new Error('REVISION_CONFLICT'))
    await act(async () => {
      await current.save()
    })
    const failedRequest: HiveWorkflowSave = api.saveWorkflow.mock.calls[0][0]
    await act(async () => {
      expect(await current.reviewLatest()).toBe(true)
    })
    expect(current.incoming).toEqual(latest)
    expect(current.baseline).toEqual(initial)
    expect(current.draft?.expectedRevision).toBe(1)
    expect(current.draft?.name).toBe('Retained draft')
    act(() => current.adoptReviewedBase())
    expect(current.incoming).toBeNull()
    expect(current.baseline).toEqual(latest)
    expect(current.draft?.name).toBe('Retained draft')
    expect(current.draft?.expectedRevision).toBe(2)
    await act(async () => {
      expect(await current.save()).toBe(true)
    })
    expect(api.saveWorkflow.mock.calls[1][0].requestId).not.toBe(failedRequest.requestId)
    expect(api.saveWorkflow.mock.calls[1][0]).toMatchObject({
      expectedRevision: 2,
      name: 'Retained draft',
      stages: failedRequest.stages
    })
    expect(current.baseline?.definition.workflowRevision).toBe(3)
  })
  it.each(['tamper', 'different-content', 'different-revision'])(
    'does not confirm a %s save response',
    async (kind) => {
      await mount()
      await create()
      api.saveWorkflow.mockImplementation((input: HiveWorkflowSave) => {
        const snapshot = savedWorkflow(input, firstTeam)
        if (kind === 'tamper') {
          snapshot.definitionDigest = '0'.repeat(64)
        }
        if (kind === 'different-content') {
          snapshot.name = 'Unrequested name'
          snapshot.definitionDigest = structuredAgentSessionDigest({
            name: snapshot.name,
            definition: snapshot.definition
          })
        }
        if (kind === 'different-revision') {
          snapshot.definition.workflowRevision = 5
          snapshot.definitionDigest = structuredAgentSessionDigest({
            name: snapshot.name,
            definition: snapshot.definition
          })
        }
        return Promise.resolve(snapshot)
      })
      let success = true
      await act(async () => {
        success = await current.save()
      })
      expect(success).toBe(false)
      expect(current.error).toBe('INVALID_RESPONSE')
      expect(current.baseline).toBeNull()
      expect(current.draft?.name).toBe('hiveWorkflow.defaultName')
    }
  )
  it('discards a late save after switching projects', async () => {
    await mount()
    await create()
    const pending = deferredWorkbenchValue<HiveWorkflowSnapshot>()
    api.saveWorkflow.mockReturnValueOnce(pending.promise)
    let result!: Promise<boolean>
    await act(async () => {
      result = current.save()
    })
    const input: HiveWorkflowSave = api.saveWorkflow.mock.calls[0][0]
    await mount(secondTeam)
    await act(async () => {
      pending.resolve(savedWorkflow(input, firstTeam))
      await result
    })
    expect(await result).toBe(false)
    expect(current.baseline).toBeNull()
    expect(current.draft).toBeNull()
    expect(api.listWorkflows).toHaveBeenLastCalledWith({
      projectId: secondTeam.project.id,
      after: undefined,
      limit: 25
    })
  })
  it('clears private drafts and ignores an old list after an account change', async () => {
    const pending = deferredWorkbenchValue<HiveWorkflowPage>()
    api.listWorkflows.mockReturnValueOnce(pending.promise)
    await mount()
    act(() => accountStateChanged(secondAccount))
    expect(current.items).toEqual([])
    expect(current.draft).toBeNull()
    await mount(firstTeam, 2)
    await act(async () => {
      pending.resolve({ items: [workflowSnapshot(firstTeam)], nextCursor: null })
    })
    expect(current.items).toEqual([])
    expect(current.error).toBeNull()
  })
  it('does not start a queued save after the account notification in the same tick', async () => {
    await mount()
    await create()
    let result!: Promise<boolean>
    await act(async () => {
      result = current.save()
      accountStateChanged(secondAccount)
      await result
    })
    expect(api.saveWorkflow).not.toHaveBeenCalled()
    expect(current.draft).toBeNull()
    expect(await result).toBe(false)
  })
  it('runs only the surviving initial request in StrictMode', async () => {
    await mount(firstTeam, 1, true)
    expect(api.listWorkflows).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(1)
  })
})
