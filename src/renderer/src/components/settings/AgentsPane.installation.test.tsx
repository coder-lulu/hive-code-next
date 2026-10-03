// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { AgentInstallResult } from '../../../../shared/agent-install-types'
import { useAppStore } from '@/store'
import {
  getLocalAgentPreflightContext,
  localPreflightContextKey
} from '@/lib/local-preflight-context'
import { resetRendererAppPlatformCacheForTests } from '@/lib/renderer-app-platform'
import { TooltipProvider } from '../ui/tooltip'
import { AgentsPane } from './AgentsPane'
import { _resetAgentInstallationStateForTest } from './use-agent-installation'

const priorApi = window.api
const priorState = useAppStore.getState()
const refreshAgents = vi.fn()
const readAgentVersion = vi.fn()
const installAgent = vi.fn()
const installed: AgentInstallResult = { status: 'installed', version: '1.2.3' }

function deferredInstallation() {
  let resolve!: (result: AgentInstallResult) => void
  const promise = new Promise<AgentInstallResult>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function mountPane() {
  function Pane() {
    const settings = useAppStore((state) => state.settings!)
    return (
      <TooltipProvider>
        <AgentsPane settings={settings} updateSettings={() => {}} />
      </TooltipProvider>
    )
  }
  return render(<Pane />)
}

describe('Agents settings installation completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetAgentInstallationStateForTest()
    resetRendererAppPlatformCacheForTests()
    refreshAgents.mockResolvedValue({ agents: ['codex', 'grok'] })
    readAgentVersion.mockResolvedValue({ status: 'ready', version: '1.2.3' })
    window.api = {
      platform: { get: () => ({ platform: 'win32' }) },
      preflight: {
        installAgent,
        refreshAgents,
        readAgentVersion,
        readLatestAgentVersion: vi.fn().mockResolvedValue({
          status: 'ready',
          version: '1.2.3',
          channel: 'npm-latest'
        })
      }
    } as unknown as typeof window.api
    useAppStore.setState({
      settings: {
        ...getDefaultSettings('/tmp'),
        localWindowsRuntimeDefault: { kind: 'windows-host' }
      },
      activeRepoId: null,
      activeWorktreeId: null,
      repos: [],
      projects: [],
      worktreesByRepo: {},
      detectedAgentIds: ['codex'],
      localDetectedAgentIdsByContext: {},
      didLocalAgentDetectionFailByContext: {},
      isDetectingLocalAgentsByContext: {},
      isRefreshingLocalAgentsByContext: {},
      settingsSearchInputQuery: '',
      settingsSearchQuery: '',
      settingsNavigationTarget: null
    })
    const contextKey = localPreflightContextKey(
      getLocalAgentPreflightContext(useAppStore.getState())
    )
    useAppStore.setState({ localDetectedAgentIdsByContext: { [contextKey]: ['codex'] } })
  })

  afterEach(() => {
    cleanup()
    window.api = priorApi
    useAppStore.setState(priorState)
    resetRendererAppPlatformCacheForTests()
  })

  it('updates shared launch choices after installation finishes with settings closed', async () => {
    const gate = deferredInstallation()
    installAgent.mockReturnValue(gate.promise)
    const pane = mountPane()
    fireEvent.click(screen.getByRole('button', { name: 'Install Grok' }))
    expect(installAgent).toHaveBeenCalledOnce()
    pane.unmount()
    await act(async () => gate.resolve(installed))
    await waitFor(() => expect(useAppStore.getState().detectedAgentIds).toContain('grok'))
    expect(refreshAgents).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(readAgentVersion).toHaveBeenCalledWith(expect.objectContaining({ agent: 'grok' }))
    )
    mountPane()
    await waitFor(() =>
      expect(document.querySelector('#agent-card-grok')?.getAttribute('data-installed')).toBe(
        'true'
      )
    )
    expect(refreshAgents).toHaveBeenCalledOnce()
  })

  it.each(['runtime', 'wsl'] as const)(
    'defers local completion after switching to %s while settings are closed',
    async (target) => {
      const settings = useAppStore.getState().settings!
      const gate = deferredInstallation()
      installAgent.mockReturnValue(gate.promise)
      const pane = mountPane()
      fireEvent.click(screen.getByRole('button', { name: 'Install Grok' }))
      pane.unmount()
      act(() =>
        useAppStore.setState({
          settings:
            target === 'runtime'
              ? { ...settings, activeRuntimeEnvironmentId: 'remote-a' }
              : { ...settings, localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu' } }
        })
      )
      await act(async () => gate.resolve(installed))
      expect(refreshAgents).not.toHaveBeenCalled()
      expect(useAppStore.getState().detectedAgentIds).not.toContain('grok')
      act(() => useAppStore.setState({ settings }))
      mountPane()
      await waitFor(() => expect(useAppStore.getState().detectedAgentIds).toContain('grok'))
      expect(refreshAgents).toHaveBeenCalledOnce()
      const context = refreshAgents.mock.calls[0][0]
      expect(context?.wslDistro).toBeUndefined()
      await waitFor(() =>
        expect(readAgentVersion).toHaveBeenCalledWith(expect.objectContaining({ agent: 'grok' }))
      )
    }
  )
})
