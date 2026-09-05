import { expect, it, vi } from 'vitest'
const connect = vi.hoisted(() => vi.fn())
vi.mock('./rpc-client', () => ({ connect }))
import { openHostLogicalClient } from './host-logical-client'

it('rejects account connections without requesting credentials or opening a socket', async () => {
  const createConnection = vi.fn()
  const socket = vi.fn()
  vi.stubGlobal('WebSocket', socket)
  try {
    await expect(
      openHostLogicalClient({ accountRuntime: { createConnection } } as never, vi.fn())
    ).rejects.toThrow('not ready')
    expect(createConnection).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
    expect(socket).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
