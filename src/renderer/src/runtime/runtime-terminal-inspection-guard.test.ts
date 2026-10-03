import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendRuntimePtyInputVerified } from './runtime-terminal-inspection'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'
import { useAppStore } from '../store'
import type { RemoteForegroundEvidence } from '../../../shared/foreground-process-evidence'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `tab-1:${LEAF_ID}`

function liveEvidence(ptyId: string, processName = 'bash'): RemoteForegroundEvidence {
  return {
    authorityGeneration: 'authority-1',
    observationEpoch: 1,
    capturedAgeMs: 0,
    ptyId,
    ptyIncarnationId: 'incarnation-1',
    verdict: 'live',
    processName,
    fence: {
      platform: 'posix',
      shellPid: 1,
      shellStartTime: '1',
      tty: '/dev/pts/1',
      foregroundPgid: 1
    }
  }
}

describe('runtime terminal owner routing', () => {
  const runtimeCall = vi.fn()
  const runtimeTransportCall = vi.fn()
  const localWrite = vi.fn()
  const localWriteAccepted = vi.fn()
  const localForeground = vi.fn()
  const localHasChildren = vi.fn()
  const localInspect = vi.fn()

  beforeEach(() => {
    clearRuntimeCompatibilityCacheForTests()
    vi.clearAllMocks()
    runtimeCall.mockResolvedValue({
      ok: true,
      result: {
        process: {
          foregroundProcess: 'bash',
          hasChildProcesses: true,
          foregroundProcessEvidence: liveEvidence('terminal-1')
        }
      },
      _meta: { runtimeId: 'runtime-1' }
    })
    runtimeTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
      return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeCall(args)
    })
    vi.stubGlobal('window', {
      api: {
        runtime: { call: runtimeCall },
        runtimeEnvironments: { call: runtimeTransportCall },
        pty: {
          write: localWrite,
          writeAccepted: localWriteAccepted,
          getForegroundProcess: localForeground,
          hasChildProcesses: localHasChildren,
          inspectProcess: localInspect
        }
      }
    })
    useAppStore.setState({
      settings: { experimentalAgentHibernation: true } as never,
      terminalLayoutsByTabId: {},
      lastTerminalInputAtByPaneKey: {}
    })
  })

  it.each(['local-pty', 'ssh:box-1@@pty-7'])(
    'guards %s through its exact local runtime handle without raw PTY writes',
    async (ptyId) => {
      useAppStore.setState({
        terminalLayoutsByTabId: {
          'tab-1': {
            root: { type: 'leaf', leafId: LEAF_ID },
            activeLeafId: LEAF_ID,
            expandedLeafId: null,
            ptyIdsByLeafId: { [LEAF_ID]: ptyId }
          }
        }
      })
      runtimeCall.mockImplementation(async ({ method }) => ({
        ok: true,
        result:
          method === 'terminal.resolvePane'
            ? { terminal: { handle: 'term-owned', ptyId, connected: true } }
            : { send: { accepted: true } }
      }))
      await expect(
        sendRuntimePtyInputVerified(
          { activeRuntimeEnvironmentId: 'unrelated' },
          ptyId,
          'chat',
          'driving',
          {
            requireAgentStatus: 'sendable'
          }
        )
      ).resolves.toBe(true)
      expect(runtimeCall).toHaveBeenCalledWith({
        method: 'terminal.resolvePane',
        params: { paneKey: PANE_KEY }
      })
      expect(runtimeCall).toHaveBeenCalledWith({
        method: 'terminal.send',
        params: {
          terminal: 'term-owned',
          text: 'chat',
          client: { id: 'orca-desktop', type: 'desktop' },
          requireAgentStatus: 'sendable'
        }
      })
      expect(localWrite).not.toHaveBeenCalled()
      expect(localWriteAccepted).not.toHaveBeenCalled()
    }
  )

  it.each(['missing', 'mismatch', 'disconnected', 'refused', 'rpc-error', 'aborted', 'rebound'])(
    'fails guarded local input closed for %s',
    async (failure) => {
      if (failure !== 'missing') {
        useAppStore.setState({
          terminalLayoutsByTabId: {
            'tab-1': {
              root: { type: 'leaf', leafId: LEAF_ID },
              activeLeafId: LEAF_ID,
              expandedLeafId: null,
              ptyIdsByLeafId: { [LEAF_ID]: 'local-pty' }
            }
          }
        })
      }
      runtimeCall.mockImplementation(async ({ method }) => {
        if (failure === 'rpc-error') {
          throw new Error('unavailable')
        }
        if (failure === 'rebound') {
          useAppStore.setState({ terminalLayoutsByTabId: {} })
        }
        return {
          ok: true,
          result:
            method === 'terminal.resolvePane'
              ? {
                  terminal: {
                    handle: 'term-owned',
                    ptyId: failure === 'mismatch' ? 'replacement' : 'local-pty',
                    connected: failure !== 'disconnected'
                  }
                }
              : { send: { accepted: false } }
        }
      })
      const controller = new AbortController()
      if (failure === 'aborted') {
        controller.abort()
      }
      await expect(
        sendRuntimePtyInputVerified(null, 'local-pty', 'chat', 'driving', {
          requireAgentStatus: 'sendable',
          signal: controller.signal
        })
      ).resolves.toBe(false)
      if (failure !== 'refused') {
        expect(runtimeCall.mock.calls.some(([request]) => request.method === 'terminal.send')).toBe(
          false
        )
      }
      expect(localWrite).not.toHaveBeenCalled()
      expect(localWriteAccepted).not.toHaveBeenCalled()
    }
  )

  it('forwards the guard to the remote owner and refuses rejected writes', async () => {
    runtimeCall.mockResolvedValue({ ok: true, result: { send: { accepted: false } } })
    await expect(
      sendRuntimePtyInputVerified(
        { activeRuntimeEnvironmentId: 'env-other' },
        'remote:env-1@@terminal-1',
        'chat',
        'driving',
        { requireAgentStatus: 'sendable' }
      )
    ).resolves.toBe(false)
    expect(runtimeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: 'env-1',
        method: 'terminal.send',
        params: expect.objectContaining({ terminal: 'terminal-1', requireAgentStatus: 'sendable' })
      })
    )
    expect(localWrite).not.toHaveBeenCalled()
    expect(localWriteAccepted).not.toHaveBeenCalled()
  })
})
