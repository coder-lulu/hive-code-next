import { describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { createHiveAgentSessionClient } from './hive-agent-session-client'
import { controlReply } from '../../../shared/hive-ai-text-control.test-fixture'

const sessionId = 'ha-session:12345678-1234-4234-8234-123456789abc'
const command = { sessionId, operationId: `1800000000000-${'a'.repeat(32)}`, profileId: 'personal' }
const receipt = { sessionId, operationId: command.operationId, status: 'pending', replayed: false }
const success = (value: unknown): RuntimeRpcResponse<unknown> => ({
  id: 'request',
  ok: true,
  result: { ok: true, value },
  _meta: { runtimeId: 'local' }
})
function setup(value: unknown = receipt) {
  const controller = new AbortController()
  const call = vi.fn(async () => success(value))
  const client = createHiveAgentSessionClient({
    projectSelector: 'id:project',
    signal: controller.signal,
    call
  })
  return { controller, call, client }
}
describe('HiveAgent desktop view client', () => {
  it('pins remote execution metadata to the selected generation without retries', async () => {
    const generationId = `ha-generation:${controlReply.requestId}`
    const value = { ...controlReply, generationId }
    const { client, call } = setup(value)
    expect(await client.execution(sessionId, generationId)).toEqual(value)
    call.mockResolvedValue(success({ ...value, generationId: controlReply.generationId }))
    await expect(client.execution(sessionId, generationId)).rejects.toThrow(
      'hive_agent_outcome_unknown'
    )
    expect(call).toHaveBeenCalledTimes(2)
  })
  it('pins read responses to the selected session', async () => {
    const value = {
      session: {
        schemaVersion: 1,
        sessionId,
        profileId: 'personal',
        createdAt: 1,
        updatedAt: 1,
        visibility: 'private',
        retention: 'until-deleted',
        stateRevision: 0
      }
    }
    const { client, call } = setup(value)
    expect(await client.read(sessionId)).toEqual(value)
    call.mockResolvedValue(
      success({
        session: { ...value.session, sessionId: 'ha-session:12345678-1234-4234-8234-123456789abd' }
      })
    )
    await expect(client.read(sessionId)).rejects.toThrow('hive_agent_outcome_unknown')
  })
  it('pins mutation identity and preserves pending status without retrying', async () => {
    const { client, call } = setup()
    expect(await client.mutate('hiveAgent.create', command)).toEqual(receipt)
    expect(call).toHaveBeenCalledExactlyOnceWith({
      method: 'hiveAgent.create',
      params: { projectSelector: 'id:project', params: command }
    })
  })
  it.each([
    { ...receipt, operationId: `1800000000000-${'b'.repeat(32)}` },
    { ...receipt, sessionId: 'ha-session:12345678-1234-4234-8234-123456789abd' },
    { ...receipt, apiKey: 'private-canary' },
    { ...receipt, status: 'COMPLETED' }
  ])('rejects a mismatched or invalid receipt %#', async (value) => {
    const { client, call } = setup(value)
    await expect(client.mutate('hiveAgent.create', command)).rejects.toThrow(
      'hive_agent_outcome_unknown'
    )
    expect(call).toHaveBeenCalledOnce()
  })
  it('does not resend a mutation after transport failure or leak its error', async () => {
    const { client, call } = setup()
    call.mockRejectedValue(new Error('private-canary'))
    await expect(client.mutate('hiveAgent.create', command)).rejects.toThrow(
      'hive_agent_outcome_unknown'
    )
    expect(call).toHaveBeenCalledOnce()
  })
  it('discards replies when the view identity changes while awaiting IPC', async () => {
    const { client, call, controller } = setup()
    call.mockImplementation(async () => {
      controller.abort()
      return success(receipt)
    })
    await expect(client.mutate('hiveAgent.create', command)).rejects.toThrow('hive_agent_forbidden')
  })
  it('rejects closed views and invalid commands before IPC', async () => {
    const { client, call, controller } = setup()
    await expect(
      client.mutate('hiveAgent.create', { ...command, operationId: 'invalid' })
    ).rejects.toThrow('hive_agent_invalid_request')
    controller.abort()
    await expect(client.list()).rejects.toThrow('hive_agent_forbidden')
    expect(call).not.toHaveBeenCalled()
  })
  it('returns the bounded session list and preserves known unavailable errors', async () => {
    const { client, call } = setup({ sessions: [], nextCursor: null })
    expect(await client.list()).toEqual({ sessions: [], nextCursor: null })
    call.mockResolvedValue({
      id: 'request',
      ok: true,
      result: { ok: false, error: { code: 'hive_agent_capability_unavailable' } },
      _meta: { runtimeId: 'local' }
    })
    await expect(client.list()).rejects.toThrow('hive_agent_capability_unavailable')
  })
})
