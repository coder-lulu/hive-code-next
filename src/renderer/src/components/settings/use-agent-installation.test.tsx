// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentInstallResult } from '../../../../shared/agent-install-types'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { useAgentInstallation, _resetAgentInstallationStateForTest } from './use-agent-installation'
import type { AgentVersionTarget } from './agent-version-cache'
import { AgentLifecycleActionButton } from './AgentLifecycleActionButton'
import { AgentInstallationFeedback } from './AgentInstallationFeedback'

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))
const target: AgentVersionTarget = { environmentId: null, platform: 'win32', wslDistro: 'Ubuntu' }
const installed: AgentInstallResult = { status: 'installed', version: '1.2.3' }
const priorApi = window.api
const install = vi.fn()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Agent installation target ownership', () => {
  it('refreshes after completion while settings are closed and retains the result on reopening', async () => {
    const gate = deferred<AgentInstallResult>()
    install.mockReturnValue(gate.promise)
    const refresh = vi.fn(async () => {})
    const first = renderHook(() => useAgentInstallation(target, true, refresh))
    let operation!: Promise<void>
    act(() => {
      operation = first.result.current.install('codex')
    })
    first.unmount()
    await act(async () => {
      gate.resolve(installed)
      await operation
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('codex'))
    const reopened = renderHook(() => useAgentInstallation(target, true, refresh))
    expect(reopened.result.current.getSnapshot('codex').result).toEqual(installed)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('shares pending state with reopened settings and refreshes through the new mounted page once', async () => {
    const gate = deferred<AgentInstallResult>()
    install.mockReturnValue(gate.promise)
    const firstRefresh = vi.fn(async () => {})
    const currentRefresh = vi.fn(async () => {})
    const first = renderHook(() => useAgentInstallation(target, true, firstRefresh))
    let operation!: Promise<void>
    act(() => {
      operation = first.result.current.install('codex')
    })
    first.unmount()
    const reopened = renderHook(() => useAgentInstallation(target, true, currentRefresh))
    expect(reopened.result.current.getSnapshot('codex').installing).toBe(true)
    expect(reopened.result.current.getSnapshot('grok').hostBusy).toBe(true)
    await act(async () => reopened.result.current.install('grok'))
    expect(install).toHaveBeenCalledOnce()
    await act(async () => {
      gate.resolve(installed)
      await operation
    })
    await waitFor(() => expect(currentRefresh).toHaveBeenCalledExactlyOnceWith('codex'))
    expect(firstRefresh).not.toHaveBeenCalled()
    expect(reopened.result.current.getSnapshot('codex').result).toEqual(installed)
    expect(reopened.result.current.getSnapshot('grok').hostBusy).toBe(false)
  })

  it('retains a failure across settings unmount and allows retry on the same host', async () => {
    const gate = deferred<AgentInstallResult>()
    install.mockReturnValueOnce(gate.promise).mockResolvedValue(installed)
    const refresh = vi.fn(async () => {})
    const first = renderHook(() => useAgentInstallation(target, true, refresh))
    let operation!: Promise<void>
    act(() => {
      operation = first.result.current.install('codex')
    })
    first.unmount()
    await act(async () => {
      gate.resolve({ status: 'error', version: null, reason: 'install-timeout' })
      await operation
    })
    const reopened = renderHook(() => useAgentInstallation(target, true, refresh))
    expect(reopened.result.current.getSnapshot('codex').result?.reason).toBe('install-timeout')
    expect(refresh).not.toHaveBeenCalled()
    await act(async () => reopened.result.current.install('codex'))
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('codex'))
    expect(install).toHaveBeenCalledTimes(2)
  })

  it('does not refresh a switched host after settings close and refreshes the original host on return', async () => {
    const gate = deferred<AgentInstallResult>()
    install.mockReturnValue(gate.promise)
    const refresh = vi.fn(async () => {})
    const first = renderHook(({ current }) => useAgentInstallation(current, true, refresh), {
      initialProps: { current: target }
    })
    let operation!: Promise<void>
    act(() => {
      operation = first.result.current.install('codex')
    })
    first.rerender({ current: { ...target, wslDistro: 'Debian' } })
    first.unmount()
    await act(async () => {
      gate.resolve(installed)
      await operation
    })
    expect(refresh).not.toHaveBeenCalled()
    renderHook(() => useAgentInstallation(target, true, refresh))
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('codex'))
  })

  it('disables every lifecycle button on a busy host without pretending other agents are loading', async () => {
    const gate = deferred<AgentInstallResult>()
    install.mockReturnValue(gate.promise)
    function Operations() {
      const lifecycle = useAgentInstallation(target, true, async () => {})
      return (
        <>
          <AgentLifecycleActionButton
            action="upgrade"
            label="Codex"
            snapshot={lifecycle.getSnapshot('codex')}
            onClick={() => void lifecycle.install('codex', 'upgrade')}
          />
          <AgentLifecycleActionButton
            action="install"
            label="Grok"
            snapshot={lifecycle.getSnapshot('grok')}
            onClick={() => void lifecycle.install('grok')}
          />
        </>
      )
    }
    render(<Operations />)
    const upgrade = screen.getByRole('button', { name: 'Upgrade Codex' })
    const grok = screen.getByRole('button', { name: 'Install Grok' })
    fireEvent.click(upgrade)
    expect(upgrade.hasAttribute('disabled')).toBe(true)
    expect(upgrade.getAttribute('aria-busy')).toBe('true')
    expect(grok.hasAttribute('disabled')).toBe(true)
    expect(grok.getAttribute('aria-busy')).toBeNull()
    expect(grok.querySelector('span.inline-grid > span:not([aria-hidden])')?.textContent).toBe(
      'Install'
    )
    expect(grok.querySelector('.animate-spin')).toBeNull()
    fireEvent.click(grok)
    expect(install).toHaveBeenCalledOnce()
    await act(async () => gate.resolve(installed))
    await waitFor(() => expect(grok.hasAttribute('disabled')).toBe(false))
  })

  it('blocks different agents across source switches while retaining their cached results', async () => {
    const failed: AgentInstallResult = {
      status: 'error',
      version: null,
      reason: 'install-failed',
      output: 'prior failure'
    }
    const gate = deferred<AgentInstallResult>()
    install
      .mockResolvedValueOnce(failed)
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue(installed)
    const refresh = vi.fn(async () => {})
    const selected: AgentVersionTarget = { ...target, registry: 'default' }
    const { result, rerender } = renderHook(
      ({ current }) => useAgentInstallation(current, true, refresh),
      { initialProps: { current: selected } }
    )
    await act(async () => result.current.install('claude'))
    let operation!: Promise<void>
    act(() => {
      operation = result.current.install('codex', 'upgrade')
    })
    expect(result.current.getSnapshot('claude').result).toEqual(failed)
    expect(result.current.getSnapshot('claude').installing).toBe(false)
    expect(result.current.getSnapshot('claude').hostBusy).toBe(true)
    await act(async () => result.current.install('claude'))
    rerender({ current: { ...selected, registry: 'china' } })
    expect(result.current.getSnapshot('grok').hostBusy).toBe(true)
    expect(result.current.getSnapshot('grok').installing).toBe(false)
    await act(async () => result.current.install('grok'))
    expect(install).toHaveBeenCalledTimes(2)
    await act(async () => {
      gate.resolve(installed)
      await operation
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('codex'))
    expect(result.current.getSnapshot('grok').hostBusy).toBe(false)
    await act(async () => result.current.install('grok'))
    expect(install).toHaveBeenLastCalledWith({
      agent: 'grok',
      action: 'install',
      registry: 'china',
      wslDistro: 'Ubuntu'
    })
    rerender({ current: selected })
    expect(result.current.getSnapshot('claude').result).toEqual(failed)
    expect(result.current.getSnapshot('claude').hostBusy).toBe(false)
  })

  it.each([
    { ...target, wslDistro: 'Debian' },
    { ...target, wslDistro: null },
    { ...target, environmentId: 'remote-a', wslDistro: null }
  ])(
    'keeps a different WSL or runtime host independent while requests remain pending',
    async (other) => {
      const first = deferred<AgentInstallResult>()
      const second = deferred<AgentInstallResult>()
      install.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      vi.mocked(callRuntimeRpc).mockReturnValue(second.promise)
      const refresh = vi.fn(async () => {})
      const { result, rerender } = renderHook(
        ({ selected }) => useAgentInstallation(selected, true, refresh),
        { initialProps: { selected: target } }
      )
      let firstOperation!: Promise<void>
      act(() => {
        firstOperation = result.current.install('codex')
      })
      rerender({ selected: other })
      expect(result.current.getSnapshot('grok').hostBusy).toBe(false)
      let secondOperation!: Promise<void>
      act(() => {
        secondOperation = result.current.install('grok')
      })
      expect(install.mock.calls.length + vi.mocked(callRuntimeRpc).mock.calls.length).toBe(2)
      expect(result.current.getSnapshot('grok').installing).toBe(true)
      expect(result.current.getSnapshot('codex').installing).toBe(false)
      rerender({ selected: target })
      expect(result.current.getSnapshot('codex').installing).toBe(true)
      expect(result.current.getSnapshot('grok').installing).toBe(false)
      expect(result.current.getSnapshot('grok').hostBusy).toBe(true)
      await act(async () => {
        second.resolve(installed)
        await secondOperation
      })
      expect(refresh).not.toHaveBeenCalled()
      expect(result.current.getSnapshot('grok').hostBusy).toBe(true)
      await act(async () => {
        first.resolve(installed)
        await firstOperation
      })
      await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('codex'))
      rerender({ selected: other })
      await waitFor(() => expect(refresh).toHaveBeenLastCalledWith('grok'))
      expect(result.current.getSnapshot('grok').result).toEqual(installed)
    }
  )

  it.each(['install', 'upgrade'] as const)(
    'shows an actionable host-busy response for %s and allows retry',
    async (action) => {
      install
        .mockResolvedValueOnce({ status: 'error', version: null, reason: 'install-busy' })
        .mockResolvedValueOnce(installed)
      const refresh = vi.fn(async () => {})
      function Operation() {
        const lifecycle = useAgentInstallation(target, true, refresh)
        const snapshot = lifecycle.getSnapshot('codex')
        return (
          <>
            <AgentLifecycleActionButton
              action={action}
              label="Codex"
              snapshot={snapshot}
              onClick={() => void lifecycle.install('codex', action)}
            />
            <AgentInstallationFeedback snapshot={snapshot} />
          </>
        )
      }
      render(<Operation />)
      const button = screen.getByRole('button', {
        name: action === 'upgrade' ? 'Upgrade Codex' : 'Install Codex'
      })
      fireEvent.click(button)
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe(
          'Another installation or upgrade is running in this environment. Wait for it to finish, then retry.'
        )
      )
      expect(refresh).not.toHaveBeenCalled()
      expect(button.hasAttribute('disabled')).toBe(false)
      expect(button.getAttribute('aria-busy')).toBeNull()
      fireEvent.click(button)
      await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('codex'))
      expect(install).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('alert')).toBeNull()
    }
  )

  it('passes upgrade action, registry and command override and retries actual verification failures', async () => {
    install
      .mockResolvedValueOnce({
        status: 'unsupported',
        version: null,
        reason: 'upgrade-installation-unverified',
        output: 'different installation'
      })
      .mockResolvedValueOnce({ ...installed, previousVersion: '1.2.2' })
    const refresh = vi.fn(async () => {})
    const selected: AgentVersionTarget = { ...target, registry: 'china' }
    const { result } = renderHook(() => useAgentInstallation(selected, true, refresh))
    await act(async () => result.current.install('codex', 'upgrade', '/custom/codex'))
    expect(install).toHaveBeenCalledWith({
      agent: 'codex',
      action: 'upgrade',
      registry: 'china',
      wslDistro: 'Ubuntu',
      commandOverride: '/custom/codex'
    })
    expect(result.current.getSnapshot('codex').action).toBe('upgrade')
    expect(result.current.getSnapshot('codex').result?.reason).toBe(
      'upgrade-installation-unverified'
    )
    expect(refresh).not.toHaveBeenCalled()
    await act(async () => result.current.install('codex', 'upgrade', '/custom/codex'))
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('codex'))
    expect(result.current.getSnapshot('codex').result?.previousVersion).toBe('1.2.2')
  })

  it('deduplicates the same physical agent across source switches and refreshes the current source', async () => {
    const gate = deferred<AgentInstallResult>()
    install.mockReturnValue(gate.promise)
    const refresh = vi.fn(async () => {})
    const selected: AgentVersionTarget = { ...target, registry: 'default' }
    const { result, rerender } = renderHook(
      ({ current }) => useAgentInstallation(current, true, refresh),
      { initialProps: { current: selected } }
    )
    let operation!: Promise<void>
    act(() => {
      operation = result.current.install('grok')
    })
    rerender({ current: { ...selected, registry: 'china' } })
    expect(result.current.getSnapshot('grok').installing).toBe(true)
    await act(async () => result.current.install('grok', 'upgrade'))
    expect(install).toHaveBeenCalledOnce()
    await act(async () => {
      gate.resolve(installed)
      await operation
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('grok'))
    expect(result.current.getSnapshot('grok').result).toBeNull()
    rerender({ current: selected })
    expect(result.current.getSnapshot('grok').result?.version).toBe(installed.version)
    expect(install).toHaveBeenCalledWith({
      agent: 'grok',
      action: 'install',
      registry: 'default',
      wslDistro: 'Ubuntu'
    })
  })

  it('uses self-upgrade capabilities without assuming an npm installation provider', async () => {
    install.mockResolvedValue(installed)
    const { result } = renderHook(() => useAgentInstallation(target, true, async () => {}))
    await act(async () => result.current.install('hermes', 'upgrade'))
    expect(install).toHaveBeenCalledExactlyOnceWith({
      agent: 'hermes',
      action: 'upgrade',
      registry: 'default',
      wslDistro: 'Ubuntu'
    })
  })

  it('accepts a verified binary provider upgrade through the same lifecycle request', async () => {
    install.mockResolvedValue(installed)
    const { result } = renderHook(() => useAgentInstallation(target, true, async () => {}))
    await act(async () => result.current.install('rovo', 'upgrade'))
    expect(install).toHaveBeenCalledExactlyOnceWith({
      agent: 'rovo',
      action: 'upgrade',
      registry: 'default',
      wslDistro: 'Ubuntu'
    })
  })
  beforeEach(() => {
    _resetAgentInstallationStateForTest()
    vi.resetAllMocks()
    window.api = { preflight: { installAgent: install } } as unknown as typeof window.api
  })
  afterEach(() => {
    cleanup()
    window.api = priorApi
  })

  it('installs in the selected WSL distro, deduplicates submission and refreshes after verification', async () => {
    const gate = deferred<AgentInstallResult>()
    install.mockReturnValue(gate.promise)
    const refresh = vi.fn(async () => {})
    const { result } = renderHook(() => useAgentInstallation(target, true, refresh))
    let pending!: Promise<void>
    act(() => {
      pending = result.current.install('codex')
      void result.current.install('codex')
    })
    expect(result.current.getSnapshot('codex').installing).toBe(true)
    expect(install).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledWith({
      agent: 'codex',
      wslDistro: 'Ubuntu',
      action: 'install',
      registry: 'default'
    })
    expect(refresh).not.toHaveBeenCalled()
    await act(async () => {
      gate.resolve(installed)
      await pending
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('codex'))
    expect(result.current.getSnapshot('codex').result).toEqual(installed)
  })

  it('retains actual failure output and allows retry without reporting success before verification', async () => {
    install
      .mockResolvedValueOnce({
        status: 'error',
        version: null,
        reason: 'node-npm-unavailable',
        output: 'npm not found'
      })
      .mockResolvedValueOnce(installed)
    const refresh = vi.fn(async () => {})
    const { result } = renderHook(() => useAgentInstallation(target, true, refresh))
    await act(async () => result.current.install('claude'))
    expect(result.current.getSnapshot('claude').result?.output).toBe('npm not found')
    expect(refresh).not.toHaveBeenCalled()
    await act(async () => result.current.install('claude'))
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('claude'))
    expect(install).toHaveBeenCalledTimes(2)
  })

  it('keeps late success on the original host and refreshes it when returning to that host', async () => {
    const gate = deferred<AgentInstallResult>()
    install.mockReturnValue(gate.promise)
    const refresh = vi.fn(async () => {})
    const other = { ...target, wslDistro: 'Debian' }
    const { result, rerender } = renderHook(
      ({ selected }) => useAgentInstallation(selected, true, refresh),
      { initialProps: { selected: target } }
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.install('codex')
    })
    rerender({ selected: other })
    expect(result.current.getSnapshot('codex').installing).toBe(false)
    await act(async () => {
      gate.resolve(installed)
      await pending
    })
    expect(result.current.getSnapshot('codex').result).toBeNull()
    expect(refresh).not.toHaveBeenCalled()
    rerender({ selected: target })
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith('codex'))
    expect(result.current.getSnapshot('codex').result).toEqual(installed)
  })

  it('uses the selected runtime with an installation timeout and refuses unverifiable or unsupported targets', async () => {
    vi.mocked(callRuntimeRpc).mockResolvedValue(installed)
    const runtime = { ...target, environmentId: 'remote-a', wslDistro: null }
    const { result, rerender } = renderHook(
      ({ available }) => useAgentInstallation(runtime, available, async () => {}),
      { initialProps: { available: false } }
    )
    await act(async () => {
      await result.current.install('codex')
      await result.current.install('aider')
    })
    expect(callRuntimeRpc).not.toHaveBeenCalled()
    rerender({ available: true })
    await act(async () => result.current.install('mimo-code'))
    expect(callRuntimeRpc).not.toHaveBeenCalled()
    await act(async () => result.current.install('codex'))
    expect(callRuntimeRpc).toHaveBeenCalledExactlyOnceWith(
      { kind: 'environment', environmentId: 'remote-a' },
      'preflight.installAgent',
      { agent: 'codex', wslDistro: null, action: 'install', registry: 'default' },
      { timeoutMs: 300_000 }
    )
    expect(install).not.toHaveBeenCalled()
  })

  it('identifies a missing preload method as an unavailable bridge', async () => {
    window.api = { preflight: {} } as typeof window.api
    const refresh = vi.fn(async () => {})
    const { result } = renderHook(() => useAgentInstallation(target, true, refresh))
    await act(async () => result.current.install('codex'))
    expect(result.current.getSnapshot('codex').result?.reason).toBe('bridge-unavailable')
    expect(refresh).not.toHaveBeenCalled()
  })
})
