import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AppState } from '../types'
import { createRuntimeDetectedAgentsSlice } from './runtime-detected-agents'

const { callRuntimeRpc } = vi.hoisted(() => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc,
  RuntimeRpcCallError: class extends Error {}
}))

function createTestStore() {
  return create<AppState>()((...args) => createRuntimeDetectedAgentsSlice(...args) as AppState)
}

describe('runtime detected agent failure state', () => {
  beforeEach(() => {
    callRuntimeRpc.mockReset()
  })

  it('keeps first failures unknown, isolates targets, and clears the error on successful probing', async () => {
    callRuntimeRpc
      .mockRejectedValueOnce(new Error('disconnected'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['codex'])
    const store = createTestStore()
    await store.getState().ensureRuntimeDetectedAgents('failed')
    expect(store.getState().runtimeDetectedAgentIds.failed).toBeUndefined()
    expect(store.getState().didRuntimeAgentDetectionFail).toEqual({ failed: true })
    await store.getState().ensureRuntimeDetectedAgents('empty')
    expect(store.getState().runtimeDetectedAgentIds.empty).toEqual([])
    expect(store.getState().didRuntimeAgentDetectionFail.empty).toBeUndefined()
    await store.getState().ensureRuntimeDetectedAgents('failed')
    expect(store.getState().runtimeDetectedAgentIds.failed).toEqual(['codex'])
    expect(store.getState().didRuntimeAgentDetectionFail.failed).toBeUndefined()
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
    expect(store.getState().didRuntimeAgentDetectionFail).toEqual({ retained: true, removed: true })

    store.getState().retainRuntimeDetectedAgents(['retained'])
    expect(store.getState().didRuntimeAgentDetectionFail).toEqual({ retained: true })
    callRuntimeRpc.mockResolvedValueOnce({ agents: [] })
    await store.getState().refreshRuntimeDetectedAgents('retained')
    expect(store.getState().didRuntimeAgentDetectionFail).toEqual({})
    expect(store.getState().runtimeDetectedAgentIds.retained).toEqual([])

    await store.getState().refreshRuntimeDetectedAgents('retained')
    store.getState().clearRuntimeDetectedAgents('retained')
    expect(store.getState().didRuntimeAgentDetectionFail).toEqual({})
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
    expect(store.getState().didRuntimeAgentDetectionFail).toEqual({})
  })
})
