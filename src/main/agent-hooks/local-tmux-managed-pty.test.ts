import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalTmuxManagedPtyResolver } from './local-tmux-managed-pty'
import type { PtyProcessInfo } from '../providers/types'

const row: PtyProcessInfo = {
  id: 'pty',
  incarnationId: 'generation',
  rootProcessId: 123,
  cwd: '/workspace',
  title: 'shell',
  worktreeId: 'folder:workspace'
}
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
if (!originalPlatform) {
  throw new Error('process.platform descriptor is unavailable')
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.useRealTimers()
})

describe('authenticated local tmux root resolution', () => {
  it('refuses Windows roots before capturing POSIX daemon inventory', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' })
    const listProcesses = vi.fn(async () => [row])
    const resolve = createLocalTmuxManagedPtyResolver({ getPtyId: () => 'pty', listProcesses })
    expect(await resolve('pane')).toBeNull()
    expect(listProcesses).not.toHaveBeenCalled()
  })
  it('shares inventory captures and accepts only the current daemon binding', async () => {
    const listProcesses = vi.fn(async () => [row])
    const resolve = createLocalTmuxManagedPtyResolver({ getPtyId: () => 'pty', listProcesses })
    const [first, second] = await Promise.all([resolve('pane'), resolve('pane')])
    expect(first).toEqual({
      pid: 123,
      incarnation: 'generation',
      scope: {
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: 'folder:workspace',
        workspaceKind: 'folder'
      }
    })
    expect(second).toEqual(first)
    expect(listProcesses).toHaveBeenCalledTimes(1)
  })
  it('refuses a binding changed during capture and excludes WSL roots from a native probe', async () => {
    let binding = 'pty'
    const resolve = createLocalTmuxManagedPtyResolver({
      getPtyId: () => binding,
      listProcesses: async () => {
        binding = 'replacement'
        return [row]
      }
    })
    expect(await resolve('pane')).toBeNull()
    const wsl = createLocalTmuxManagedPtyResolver({
      getPtyId: () => 'pty',
      listProcesses: async () => [{ ...row, wslDistro: 'Ubuntu-24.04' }]
    })
    expect(await wsl('pane')).toBeNull()
  })
  it('refreshes expired inventory instead of assigning a reused PID to the old incarnation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const listProcesses = vi
      .fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ ...row, incarnationId: 'replacement' }])
    const resolve = createLocalTmuxManagedPtyResolver({ getPtyId: () => 'pty', listProcesses })
    expect((await resolve('pane'))?.incarnation).toBe('generation')
    vi.setSystemTime(2001)
    expect((await resolve('pane'))?.incarnation).toBe('replacement')
  })
})
