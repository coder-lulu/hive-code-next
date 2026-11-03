import { beforeEach, expect, it, vi } from 'vitest'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  owner: vi.fn<() => { target: RuntimeClientTarget; terminal: string } | null>(),
  record: vi.fn(),
  layouts: {} as Record<string, { ptyIdsByLeafId: Record<string, string> }>,
  write: vi.fn(),
  writeAccepted: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ terminalLayoutsByTabId: mocks.layouts }) }
}))
vi.mock('./runtime-rpc-client', () => ({ callRuntimeRpc: mocks.call }))
vi.mock('./runtime-terminal-stream', () => ({ getRemoteRuntimePtyOwner: mocks.owner }))
vi.mock('./runtime-terminal-input-recording', () => ({
  recordRuntimeTerminalInputForPtyId: mocks.record
}))
import { sendRuntimePtyInputVerified } from './runtime-terminal-verified-input'

const leaf = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.owner.mockReturnValue(null)
  mocks.layouts = { tab: { ptyIdsByLeafId: { [leaf]: 'pty' } } }
  mocks.call.mockImplementation(async (_target, method) =>
    method === 'terminal.resolvePane'
      ? { terminal: { handle: 'owned', ptyId: 'pty', connected: true } }
      : { send: { accepted: true } }
  )
  vi.stubGlobal('window', {
    api: { pty: { write: mocks.write, writeAccepted: mocks.writeAccepted } }
  })
})

it('resolves and guards the exact local host handle with no direct PTY fallback', async () => {
  await expect(
    sendRuntimePtyInputVerified('pty', 'body', 'driving', { requireAgentStatus: 'sendable' })
  ).resolves.toBe(true)
  expect(mocks.call).toHaveBeenNthCalledWith(
    1,
    { kind: 'local' },
    'terminal.resolvePane',
    { paneKey: `tab:${leaf}` },
    expect.any(Object)
  )
  expect(mocks.call).toHaveBeenNthCalledWith(
    2,
    { kind: 'local' },
    'terminal.send',
    expect.objectContaining({ terminal: 'owned', requireAgentStatus: 'sendable' }),
    expect.any(Object)
  )
  expect(mocks.write).not.toHaveBeenCalled()
  expect(mocks.writeAccepted).not.toHaveBeenCalled()
})

it.each(['missing', 'rebound', 'mismatch', 'disconnected', 'refused', 'error', 'aborted'])(
  'fails guarded delivery closed for %s',
  async (failure) => {
    const controller = new AbortController()
    if (failure === 'missing') {
      mocks.layouts = {}
    }
    if (failure === 'aborted') {
      controller.abort()
    }
    mocks.call.mockImplementation(async (_target, method) => {
      if (failure === 'error') {
        throw new Error('unavailable')
      }
      if (failure === 'rebound') {
        mocks.layouts = {}
      }
      return method === 'terminal.resolvePane'
        ? {
            terminal: {
              handle: 'owned',
              ptyId: failure === 'mismatch' ? 'replacement' : 'pty',
              connected: failure !== 'disconnected'
            }
          }
        : { send: { accepted: false } }
    })
    await expect(
      sendRuntimePtyInputVerified('pty', 'body', 'driving', {
        requireAgentStatus: 'sendable',
        signal: controller.signal
      })
    ).resolves.toBe(false)
    if (failure !== 'refused') {
      expect(mocks.call.mock.calls.some((call) => call[1] === 'terminal.send')).toBe(false)
    }
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.writeAccepted).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
  }
)

it('preserves remote ownership and forwards the guard without a local fallback', async () => {
  const target = { kind: 'environment', environmentId: 'env' } as const
  mocks.owner.mockReturnValue({ target, terminal: 'remote-owned' })
  mocks.call.mockResolvedValue({ send: { accepted: false } })
  await expect(
    sendRuntimePtyInputVerified('remote:env@@remote-owned', 'body', 'driving', {
      requireAgentStatus: 'sendable'
    })
  ).resolves.toBe(false)
  expect(mocks.call).toHaveBeenCalledExactlyOnceWith(
    target,
    'terminal.send',
    expect.objectContaining({ terminal: 'remote-owned', requireAgentStatus: 'sendable' }),
    expect.any(Object)
  )
  expect(mocks.write).not.toHaveBeenCalled()
})
