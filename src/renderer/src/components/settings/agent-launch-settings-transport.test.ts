import { AGENT_LAUNCH_PERMISSION_CHOICE_CAPABILITY } from '../../../../shared/agent-launch-runtime-capability'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectAgentLaunchSettings } from '../../../../shared/agent-launch-settings'
const rpc = vi.hoisted(() => ({ call: vi.fn(), supports: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: rpc.call,
  runtimeEnvironmentSupportsCapability: rpc.supports
}))
import {
  readHostAgentLaunchSettings,
  mutateHostAgentLaunchSettings
} from './agent-launch-settings-transport'

beforeEach(() => {
  rpc.call.mockReset()
  rpc.supports.mockReset().mockResolvedValue(true)
  rpc.call.mockResolvedValue({
    settings: projectAgentLaunchSettings({ agentDefaultArgs: { claude: '--host' } })
  })
})

describe('host agent launch settings transport', () => {
  it('reads and writes the same captured peer without a desktop settings write', async () => {
    const owner = { environmentId: 'ssh-host', pairingRevision: 17 }
    const signal = new AbortController().signal
    const settings = await readHostAgentLaunchSettings(owner, signal)
    await mutateHostAgentLaunchSettings(
      owner,
      { type: 'arguments', agent: 'claude', value: '--marker' },
      signal
    )
    expect(settings?.agentDefaultArgs.claude).toBe('--host')
    expect(rpc.call.mock.calls).toEqual([
      [
        { kind: 'environment', environmentId: 'ssh-host' },
        'settings.getAgentLaunch',
        undefined,
        { expectedEnvironmentPairingRevision: 17, signal, timeoutMs: 15000 }
      ],
      [
        { kind: 'environment', environmentId: 'ssh-host' },
        'settings.mutateAgentLaunch',
        { type: 'arguments', agent: 'claude', value: '--marker' },
        { expectedEnvironmentPairingRevision: 17, signal, timeoutMs: 15000 }
      ]
    ])
  })

  it('sends no new method or strict-schema field to an old server', async () => {
    rpc.supports.mockResolvedValue(false)
    expect(await readHostAgentLaunchSettings({ environmentId: 'old' })).toBeNull()
    await expect(
      mutateHostAgentLaunchSettings({ environmentId: 'old' }, { type: 'permissions', mode: 'ask' })
    ).rejects.toThrow('unsupported')
    expect(rpc.call).not.toHaveBeenCalled()
  })

  it('does not retry an unavailable host against the local settings store', async () => {
    rpc.call.mockRejectedValue(new Error('unavailable'))
    await expect(readHostAgentLaunchSettings({ environmentId: 'offline' })).rejects.toThrow(
      'unavailable'
    )
    expect(rpc.call).toHaveBeenCalledTimes(1)
    expect(rpc.call.mock.calls[0]?.[0]).toEqual({ kind: 'environment', environmentId: 'offline' })
  })
})

it('sends scoped reset with the captured peer runtime identity', async () => {
  const mutation = {
    type: 'permissions' as const,
    agent: 'claude' as const,
    mode: 'default' as const
  }
  await mutateHostAgentLaunchSettings(
    { environmentId: 'host', pairingRevision: 4, runtimeId: 'runtime-4' },
    mutation
  )
  expect(rpc.call).toHaveBeenCalledWith(
    { kind: 'environment', environmentId: 'host' },
    'settings.mutateAgentLaunch',
    mutation,
    expect.objectContaining({
      expectedEnvironmentPairingRevision: 4,
      expectedEnvironmentRuntimeId: 'runtime-4'
    })
  )
})
it('refuses typed permission writes without the current permission-choice capability', async () => {
  rpc.supports.mockImplementation(
    async (_host, capability) => capability !== AGENT_LAUNCH_PERMISSION_CHOICE_CAPABILITY
  )
  await expect(
    mutateHostAgentLaunchSettings(
      { environmentId: 'old' },
      { type: 'permissions', agent: 'claude', mode: 'default' }
    )
  ).rejects.toThrow('permission_choice_unsupported')
  expect(rpc.call).not.toHaveBeenCalled()
})
