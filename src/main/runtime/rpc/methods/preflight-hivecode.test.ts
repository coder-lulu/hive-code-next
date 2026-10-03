import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eraseRpcMethods } from '../core'
import { PREFLIGHT_METHODS } from './preflight'
import {
  detectInstalledAgentsWithShellPathHydration,
  detectRemoteAgents,
  refreshShellPathAndDetectAgents
} from '../../../preflight/agent-detection'

vi.mock('../../../preflight/agent-install-service', () => ({ installAgent: vi.fn() }))
vi.mock('../../../preflight/agent-version-service', () => ({
  readAgentVersion: vi.fn(),
  readLatestAgentVersion: vi.fn()
}))
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
  return method.handler(params, {} as never)
}

describe('Host built-in agent discovery for remote workspaces', () => {
  beforeEach(() => vi.resetAllMocks())

  it('offers HiveCode AI on a Host without external agents', async () => {
    vi.mocked(detectInstalledAgentsWithShellPathHydration).mockResolvedValue([])
    expect(await invoke('preflight.detectAgents')).toEqual(['hivecode'])
  })

  it('preserves external agents and deduplicates the built-in agent', async () => {
    vi.mocked(detectInstalledAgentsWithShellPathHydration).mockResolvedValue(['codex', 'hivecode'])
    expect(await invoke('preflight.detectAgents')).toEqual(['codex', 'hivecode'])
  })

  it('keeps HiveCode AI after refresh and preserves hydration evidence', async () => {
    const result = {
      agents: ['pi'],
      addedPathSegments: ['/tools'],
      shellHydrationOk: true,
      pathSource: 'shell_hydrate' as const,
      pathFailureReason: 'none' as const
    }
    vi.mocked(refreshShellPathAndDetectAgents).mockResolvedValue(result)
    expect(await invoke('preflight.refreshAgents')).toEqual({
      ...result,
      agents: ['pi', 'hivecode']
    })
    expect(result.agents).toEqual(['pi'])
  })

  it('does not advertise Host capabilities for an SSH execution host', async () => {
    vi.mocked(detectRemoteAgents).mockResolvedValue(['pi'])
    expect(await invoke('preflight.detectRemoteAgents', { connectionId: 'ssh-target' })).toEqual([
      'pi'
    ])
    expect(detectRemoteAgents).toHaveBeenCalledWith({ connectionId: 'ssh-target' })
  })

  it('preserves detection failures instead of fabricating a successful response', async () => {
    vi.mocked(detectInstalledAgentsWithShellPathHydration).mockRejectedValue(new Error('offline'))
    await expect(invoke('preflight.detectAgents')).rejects.toThrow('offline')
  })
})
