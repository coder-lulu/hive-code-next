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
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type {
  AgentVersionRequest,
  LatestAgentVersionRequest,
  LatestAgentVersionResult
} from '../../../../shared/agent-version-types'
import type { AgentVersionTarget } from './agent-version-cache'
import { useAgentVersions } from './use-agent-versions'

const target = { environmentId: null, platform: 'win32', wslDistro: null }
const agents: TuiAgent[] = ['claude', 'codex']

function Versions({ overrides }: { overrides: Partial<Record<TuiAgent, string>> }) {
  const versions = useAgentVersions(target, agents, overrides)
  return (
    <>
      {agents.map((agent) => (
        <output key={agent} aria-label={`${agent} current version`}>
          {versions.snapshots[agent].current?.version ?? 'Reading…'}
        </output>
      ))}
      <button onClick={() => void versions.checkLatest()}>Check updates</button>
    </>
  )
}

afterEach(cleanup)

describe('mounted agent versions', () => {
  it('passes the selected registry, isolates late responses and refreshes when changing back', async () => {
    const priorApi = window.api
    const detected: TuiAgent[] = ['grok']
    const overrides = {}
    const selected: AgentVersionTarget = {
      ...target,
      platform: 'registry-switch-test',
      registry: 'default'
    }
    let resolveFirst!: (value: LatestAgentVersionResult) => void
    const first = new Promise<LatestAgentVersionResult>((resolve) => {
      resolveFirst = resolve
    })
    let defaultReads = 0
    const readLatest = vi.fn(async ({ registry }: LatestAgentVersionRequest) => {
      if (registry === 'default' && ++defaultReads === 1) {
        return first
      }
      return {
        status: 'ready' as const,
        version: registry === 'china' ? '2.0.0' : '3.0.0',
        channel: 'npm-latest' as const
      }
    })
    window.api = {
      preflight: {
        readAgentVersion: vi.fn(async () => ({ status: 'ready', version: '1.0.0' })),
        readLatestAgentVersion: readLatest
      }
    } as unknown as typeof window.api
    try {
      const { result, rerender } = renderHook(
        ({ current }) => useAgentVersions(current, detected, overrides),
        { initialProps: { current: selected } }
      )
      await waitFor(() =>
        expect(readLatest).toHaveBeenCalledWith({ agent: 'grok', registry: 'default' })
      )
      rerender({ current: { ...selected, registry: 'china' } })
      await waitFor(() => expect(result.current.snapshots.grok.latest?.version).toBe('2.0.0'))
      expect(readLatest).toHaveBeenCalledWith({ agent: 'grok', registry: 'china' })
      await act(async () => {
        resolveFirst({ status: 'ready', version: '1.5.0', channel: 'npm-latest' })
        await first
      })
      expect(result.current.snapshots.grok.latest?.version).toBe('2.0.0')
      rerender({ current: selected })
      await waitFor(() => expect(result.current.snapshots.grok.latest?.version).toBe('3.0.0'))
      expect(readLatest).toHaveBeenCalledTimes(3)
    } finally {
      cleanup()
      window.api = priorApi
    }
  })
  it('distinguishes a missing bridge and can retry after the current tools become available', async () => {
    const priorApi = window.api
    const selected = { ...target, platform: 'missing-preload-test' }
    const detected: TuiAgent[] = ['codex']
    window.api = { preflight: {} } as unknown as typeof window.api
    try {
      const { result } = renderHook(() => useAgentVersions(selected, detected, {}))
      await waitFor(() =>
        expect(result.current.snapshots.codex.current?.reason).toBe('bridge-unavailable')
      )
      expect(result.current.snapshots.codex.latest?.reason).toBe('bridge-unavailable')
      window.api = {
        preflight: {
          readAgentVersion: vi.fn(async () => ({ status: 'ready', version: '1.2.3' })),
          readLatestAgentVersion: vi.fn(async () => ({
            status: 'ready',
            version: '1.2.4',
            channel: 'npm-latest'
          }))
        }
      } as unknown as typeof window.api
      act(() => result.current.retry('codex'))
      await waitFor(() => expect(result.current.snapshots.codex.current?.version).toBe('1.2.3'))
      expect(result.current.snapshots.codex.latest?.version).toBe('1.2.4')
    } finally {
      cleanup()
      window.api = priorApi
    }
  })

  it('refreshes a newly installed agent before it appears in the detected list', async () => {
    const priorApi = window.api
    const selected = { ...target, platform: 'after-install-test', wslDistro: 'Ubuntu' }
    const readCurrent = vi.fn(async () => ({ status: 'ready', version: '2.1.0' }))
    window.api = {
      preflight: {
        readAgentVersion: readCurrent,
        readLatestAgentVersion: vi.fn(async () => ({
          status: 'ready',
          version: '2.1.0',
          channel: 'npm-latest'
        }))
      }
    } as unknown as typeof window.api
    try {
      const { result, rerender } = renderHook(
        ({ detected }) => useAgentVersions(selected, detected, {}),
        { initialProps: { detected: [] as TuiAgent[] } }
      )
      await act(async () => {
        await result.current.refresh('gemini')
      })
      expect(readCurrent).toHaveBeenCalledExactlyOnceWith({
        agent: 'gemini',
        wslDistro: 'Ubuntu',
        commandOverride: undefined
      })
      rerender({ detected: ['gemini'] })
      expect(result.current.snapshots.gemini.current?.version).toBe('2.1.0')
      expect(readCurrent).toHaveBeenCalledOnce()
    } finally {
      cleanup()
      window.api = priorApi
    }
  })

  it('keeps the visible current version through cache eviction and update checks', async () => {
    const priorApi = window.api
    window.api = {
      ...priorApi,
      preflight: {
        ...priorApi?.preflight,
        readAgentVersion: vi.fn(async ({ agent, commandOverride }: AgentVersionRequest) => ({
          status: 'ready' as const,
          version:
            agent === 'claude' ? '1.2.3' : `1.0.${Number(commandOverride?.split('-')[1] ?? -1) + 1}`
        })),
        readLatestAgentVersion: vi.fn(async () => ({
          status: 'ready' as const,
          version: '2.0.0',
          channel: 'npm-latest' as const
        }))
      }
    } as Window['api']
    try {
      const view = render(<Versions overrides={{}} />)
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByLabelText('claude current version').textContent).toBe('1.2.3')
      for (let index = 0; index < 255; index++) {
        await act(async () => view.rerender(<Versions overrides={{ codex: `codex-${index}` }} />))
      }
      expect(screen.getByLabelText('codex current version').textContent).toBe('1.0.255')
      expect(screen.getByLabelText('claude current version').textContent).toBe('1.2.3')
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Check updates' })))
      expect(screen.getByLabelText('claude current version').textContent).toBe('1.2.3')
    } finally {
      cleanup()
      window.api = priorApi
    }
  })
})
