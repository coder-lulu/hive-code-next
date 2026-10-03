import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPreflightApi } from './web-preflight-api'

const { callRuntime, activeEnvironment } = vi.hoisted(() => ({
  callRuntime: vi.fn(),
  activeEnvironment: vi.fn()
}))

describe('paired Web agent version boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeEnvironment.mockReturnValue({ id: 'paired-runtime' })
    callRuntime.mockResolvedValue({ status: 'ready', version: '1.2.3', channel: 'npm-latest' })
  })

  it('forwards both exact controlled version requests to the paired Runtime', async () => {
    const api = createPreflightApi({
      callRuntimeResult: callRuntime,
      requireActiveEnvironmentOrNull: activeEnvironment
    })
    const args = { agent: 'codex' as const, commandOverride: '/opt/codex', wslDistro: null }
    await api.readAgentVersion(args)
    await api.readLatestAgentVersion({ agent: 'codex' })
    expect(callRuntime.mock.calls).toEqual([
      ['preflight.readAgentVersion', args],
      ['preflight.readLatestAgentVersion', { agent: 'codex' }]
    ])
  })

  it('returns an explicit unavailable result without a paired environment', async () => {
    activeEnvironment.mockReturnValue(null)
    const api = createPreflightApi({
      callRuntimeResult: callRuntime,
      requireActiveEnvironmentOrNull: activeEnvironment
    })
    expect(await api.readAgentVersion({ agent: 'codex' })).toMatchObject({
      status: 'error',
      version: null,
      reason: 'environment-unverifiable'
    })
    expect(await api.readLatestAgentVersion({ agent: 'codex' })).toMatchObject({
      status: 'error',
      version: null,
      reason: 'environment-unverifiable',
      channel: 'npm-latest'
    })
    expect(await api.installAgent({ agent: 'codex' })).toMatchObject({
      status: 'error',
      reason: 'environment-unverifiable'
    })
    expect(callRuntime).not.toHaveBeenCalled()
  })

  it('uses the same paired Runtime and sufficient client timeout for installation', async () => {
    const api = createPreflightApi({
      callRuntimeResult: callRuntime,
      requireActiveEnvironmentOrNull: activeEnvironment
    })
    await api.installAgent({ agent: 'codex', wslDistro: 'Ubuntu' })
    expect(callRuntime).toHaveBeenCalledWith(
      'preflight.installAgent',
      { agent: 'codex', wslDistro: 'Ubuntu' },
      300_000
    )
  })

  it('does not fabricate version success or retry through another host after disconnection', async () => {
    callRuntime.mockRejectedValue(new Error('disconnected'))
    const api = createPreflightApi({
      callRuntimeResult: callRuntime,
      requireActiveEnvironmentOrNull: activeEnvironment
    })
    await expect(api.readAgentVersion({ agent: 'codex' })).rejects.toThrow('disconnected')
    await expect(api.readLatestAgentVersion({ agent: 'codex' })).rejects.toThrow('disconnected')
    expect(callRuntime).toHaveBeenCalledTimes(2)
  })
})
