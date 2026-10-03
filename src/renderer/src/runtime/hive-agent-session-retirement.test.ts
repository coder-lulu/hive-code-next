import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn(), mutate: vi.fn() }))
vi.mock('./hive-agent-session-client', () => ({ createHiveAgentSessionClient: () => mocks }))
vi.mock('./agent-session-operation-id', () => ({
  createAgentSessionOperationId: () => 'operation'
}))
import { retireHiveAgentSession } from './hive-agent-session-retirement'
beforeEach(() => {
  vi.stubGlobal('window', { api: { runtime: { call: vi.fn() } } })
  mocks.read.mockReset()
  mocks.mutate.mockReset().mockResolvedValue({ status: 'succeeded' })
})
it('cancels active execution before deleting local history', async () => {
  mocks.read.mockResolvedValue({ generation: { generationId: 'generation', state: 'RUNNING' } })
  await retireHiveAgentSession('workspace', 'session')
  expect(mocks.mutate.mock.calls.map(([method]) => method)).toEqual([
    'hiveAgent.cancel',
    'hiveAgent.delete'
  ])
})
it('deletes unknown local history without claiming a remote cancellation', async () => {
  mocks.read.mockResolvedValue({ generation: { state: 'UNKNOWN' } })
  await retireHiveAgentSession('workspace', 'session')
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith('hiveAgent.delete', {
    sessionId: 'session',
    operationId: 'operation'
  })
})
it('preserves the session when cancellation is unconfirmed', async () => {
  mocks.read.mockResolvedValue({ generation: { generationId: 'generation', state: 'RUNNING' } })
  mocks.mutate.mockResolvedValue({ status: 'unknown' })
  await expect(retireHiveAgentSession('workspace', 'session')).rejects.toThrow(
    'hive_agent_outcome_unknown'
  )
  expect(mocks.mutate).toHaveBeenCalledTimes(1)
})
