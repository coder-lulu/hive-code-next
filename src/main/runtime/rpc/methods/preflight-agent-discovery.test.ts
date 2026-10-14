import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eraseRpcMethods } from '../core'
import { PREFLIGHT_METHODS } from './preflight'
import { detectAgentsOnHost, refreshAgentsOnHost } from '../../../preflight/workspace-agent-detection'

vi.mock('../../../preflight/agent-install-service', () => ({ installAgent: vi.fn() }))
vi.mock('../../../preflight/agent-version-service', () => ({
  readAgentVersion: vi.fn(),
  readLatestAgentVersion: vi.fn()
}))
vi.mock('../../../preflight/workspace-agent-detection', () => ({ detectAgentsOnHost: vi.fn(), refreshAgentsOnHost: vi.fn() }))
vi.mock('../../../preflight/agent-detection', () => ({
  detectInstalledAgentsWithShellPathHydration: vi.fn(),
  refreshShellPathAndDetectAgents: vi.fn(),
  detectRemoteAgents: vi.fn(),
  detectRemoteWindowsTerminalCapabilities: vi.fn(),
  runPreflightCheck: vi.fn()
}))

function invoke(name: string, params?: unknown) {
  const method = eraseRpcMethods(PREFLIGHT_METHODS).find((entry) => entry.name === name)
  if (!method) {
    throw new Error(`Missing method ${name}`)
  }
  return method.handler(params ?? {}, {
    runtime: { resolveAgentDetectionHost: vi.fn(async () => ({ kind: 'local' })) } as unknown as Parameters<typeof method.handler>[1]['runtime']
  })
}

describe('Host external agent discovery for remote workspaces', () => {
  beforeEach(() => vi.resetAllMocks())

  it('reports no agents when no external agents are installed', async () => {
    vi.mocked(detectAgentsOnHost).mockResolvedValue([])
    expect(await invoke('preflight.detectAgents')).toEqual([])
  })

  it('preserves detected external agents', async () => {
    vi.mocked(detectAgentsOnHost).mockResolvedValue(['codex', 'pi'])
    expect(await invoke('preflight.detectAgents')).toEqual(['codex', 'pi'])
  })

  it('preserves detected agents and hydration evidence after refresh', async () => {
    const result = {
      agents: ['pi'],
      addedPathSegments: ['/tools'],
      shellHydrationOk: true,
      pathSource: 'shell_hydrate' as const,
      pathFailureReason: 'none' as const
    }
    vi.mocked(refreshAgentsOnHost).mockResolvedValue(result)
    expect(await invoke('preflight.refreshAgents')).toEqual({
      ...result,
      agents: ['pi']
    })
    expect(result.agents).toEqual(['pi'])
  })

  it('does not advertise Host capabilities for an SSH execution host', async () => {
    vi.mocked(detectAgentsOnHost).mockResolvedValue(['pi'])
    expect(await invoke('preflight.detectRemoteAgents', { connectionId: 'ssh-target' })).toEqual([
      'pi'
    ])
    expect(detectAgentsOnHost).toHaveBeenCalledWith({ kind: 'ssh', connectionId: 'ssh-target' })
  })

  it('preserves detection failures instead of fabricating a successful response', async () => {
    vi.mocked(detectAgentsOnHost).mockRejectedValue(new Error('offline'))
    await expect(invoke('preflight.detectAgents')).rejects.toThrow('offline')
  })
})
