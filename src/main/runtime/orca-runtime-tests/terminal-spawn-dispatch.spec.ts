import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService, electronMocks } from '../orca-runtime-test-mocks.spec'
import { TEST_WORKTREE_ID, TEST_WORKTREE_PATH, store } from '../orca-runtime-test-fixtures.spec'

// `agent.launch` settles a launch as failed only when its create threw before this hook ran.
describe('OrcaRuntimeService createTerminal spawn dispatch', () => {
  it('reports the spawn request before it leaves for the pty controller', async () => {
    const dispatched = vi.fn()
    const spawn = vi.fn(async () => {
      expect(dispatched).toHaveBeenCalledOnce()
      expect(dispatched).toHaveBeenCalledWith({
        worktreeId: TEST_WORKTREE_ID,
        workspacePath: TEST_WORKTREE_PATH,
        connectionId: null,
        cwd: TEST_WORKTREE_PATH,
        launchAgent: 'codex',
        launchConfig: {
          agentArgs: '--dangerously-bypass-approvals-and-sandbox',
          agentCommand: "codex '--dangerously-bypass-approvals-and-sandbox'",
          agentEnv: {}
        }
      })
      return { id: 'pty-dispatch' }
    })
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`, {
      command: 'codex',
      onPtySpawnDispatched: dispatched
    })

    expect(spawn).toHaveBeenCalledOnce()
  })

  it('reports it even when the spawn itself then fails', async () => {
    const dispatched = vi.fn()
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn: vi.fn(async () => {
        throw new Error('ssh_channel_closed')
      }),
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    await expect(
      runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`, {
        command: 'codex',
        onPtySpawnDispatched: dispatched
      })
    ).rejects.toThrow('ssh_channel_closed')
    expect(dispatched).toHaveBeenCalledOnce()
  })

  it('does not report it when the create fails before any spawn request', async () => {
    const dispatched = vi.fn()
    const spawn = vi.fn()
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    await expect(
      runtime.createTerminal('path:/no/such/workspace', {
        command: 'codex',
        onPtySpawnDispatched: dispatched
      })
    ).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
    expect(dispatched).not.toHaveBeenCalled()
  })

  it('lets the guard reject the resolved desktop scope before IPC dispatch', async () => {
    const webContents = { send: vi.fn() }
    electronMocks.BrowserWindow.fromId.mockReturnValue({
      isDestroyed: () => false,
      webContents
    })
    const runtime = new OrcaRuntimeService(store)
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
    const dispatched = vi.fn((scope: unknown) => {
      expect(scope).toEqual({
        worktreeId: TEST_WORKTREE_ID,
        workspacePath: TEST_WORKTREE_PATH,
        connectionId: null,
        cwd: undefined
      })
      throw new Error('task_cancelled')
    })

    await expect(
      runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`, {
        command: 'codex',
        rendererBacked: true,
        onPtySpawnDispatched: dispatched
      })
    ).rejects.toThrow('task_cancelled')
    expect(dispatched).toHaveBeenCalledOnce()
    expect(webContents.send).not.toHaveBeenCalled()
  })

  it('does not mark dispatch before desktop workspace preparation fails', async () => {
    const webContents = { send: vi.fn() }
    electronMocks.BrowserWindow.fromId.mockReturnValue({
      isDestroyed: () => false,
      webContents
    })
    const runtime = new OrcaRuntimeService(store)
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
    const dispatched = vi.fn()

    await expect(
      runtime.createTerminal('path:/no/such/workspace', {
        command: 'codex',
        rendererBacked: true,
        onPtySpawnDispatched: dispatched
      })
    ).rejects.toThrow()
    expect(dispatched).not.toHaveBeenCalled()
    expect(webContents.send).not.toHaveBeenCalled()
  })
})
