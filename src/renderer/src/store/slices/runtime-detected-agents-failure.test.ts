import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import {
  createRuntimeDetectedAgentsSlice,
  type RuntimeDetectedAgentsStoreState
} from './runtime-detected-agents'

const { callRuntimeRpc } = vi.hoisted(() => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc
}))

function createTestStore() {
  return create<RuntimeDetectedAgentsStoreState>()((...args) => ({
    repos: [],
    worktreesByRepo: {},
    folderWorkspaces: [],
    projectGroups: [],
    ...createRuntimeDetectedAgentsSlice(...args)
  }))
}

describe('runtime detected agent failure state', () => {
  beforeEach(() => {
    callRuntimeRpc.mockReset()
    createTestStore().getState().retainRuntimeDetectedAgents([])
  })

  it('keeps first failures unknown, isolates targets, and clears the error on successful probing', async () => {
    callRuntimeRpc
      .mockRejectedValueOnce(new Error('disconnected'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['codex'])
    const store = createTestStore()
    await store.getState().ensureRuntimeDetectedAgents('failed')
    expect(store.getState().runtimeDetectedAgentIds.failed).toBeUndefined()
    expect(store.getState().runtimeAgentInventoryOutcome('failed')).toBe('failed')
    await store.getState().ensureRuntimeDetectedAgents('empty')
    expect(store.getState().runtimeDetectedAgentIds.empty).toEqual([])
    expect(store.getState().runtimeAgentInventoryOutcome('empty')).toBe('successful')
    await store.getState().ensureRuntimeDetectedAgents('failed')
    expect(store.getState().runtimeDetectedAgentIds.failed).toEqual(['codex'])
    expect(store.getState().runtimeAgentInventoryOutcome('failed')).toBe('successful')
  })

  it('preserves verified agents after a failed refresh and clears errors on recovery and environment removal', async () => {
    const store = createTestStore()
    store.setState({ runtimeDetectedAgentIds: { retained: ['claude'], removed: ['codex'] } })
    callRuntimeRpc.mockRejectedValue(new Error('disconnected'))
    await store.getState().refreshRuntimeDetectedAgents('retained')
    await store.getState().refreshRuntimeDetectedAgents('removed')
    expect(store.getState().runtimeDetectedAgentIds).toEqual({
      retained: ['claude'],
      removed: ['codex']
    })
    expect(store.getState().runtimeAgentInventoryOutcome('retained')).toBe('failed')
    expect(store.getState().runtimeAgentInventoryOutcome('removed')).toBe('failed')

    store.getState().retainRuntimeDetectedAgents(['retained'])
    expect(store.getState().runtimeAgentInventoryOutcome('retained')).toBe('failed')
    expect(store.getState().runtimeAgentInventoryOutcome('removed')).toBe('pending')
    callRuntimeRpc.mockResolvedValueOnce({ agents: [] })
    await store.getState().refreshRuntimeDetectedAgents('retained')
    expect(store.getState().runtimeAgentInventoryOutcome('retained')).toBe('successful')
    expect(store.getState().runtimeDetectedAgentIds.retained).toEqual([])

    await store.getState().refreshRuntimeDetectedAgents('retained')
    store.getState().clearRuntimeDetectedAgents('retained')
    expect(store.getState().runtimeAgentInventoryOutcome('retained')).toBe('pending')
  })

  it('does not restore an error after a failed in-flight request was cleared', async () => {
    let rejectProbe: (error: Error) => void = () => {}
    callRuntimeRpc.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectProbe = reject
      })
    )
    const store = createTestStore()
    const pending = store.getState().refreshRuntimeDetectedAgents('removed')
    store.getState().retainRuntimeDetectedAgents([])
    rejectProbe(new Error('disconnected'))
    await pending
    expect(store.getState().runtimeAgentInventoryOutcome('removed')).toBe('pending')
  })
})
