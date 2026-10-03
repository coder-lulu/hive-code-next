import { mkdir, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { runtimeStub, rpcContext } from '../runtime/rpc/methods/agent-launch.test-fixture'
import {
  AGENT_LAUNCH_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import { TaskExecutionError } from './task-execution-error'
import { taskCommand, taskTestDirectory, taskWorkspace } from './task-execution.test-fixture'

const { installedHost } = vi.hoisted(() => ({ installedHost: vi.fn() }))
vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: installedHost
}))
const { createTaskAgentLaunchPort } = await import('./task-agent-launch-port')
let directory: string | undefined
afterEach(async () => {
  installedHost.mockReset()
  if (directory) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  directory = await taskTestDirectory()
  const now = Date.now()
  const store = await openTestAgentSessionRecordStore(directory)
  const { record } = await store.tasks.admit({
    command: taskCommand({
      operationId: `${now}-${'b'.repeat(32)}`,
      expiresAt: new Date(now + 60_000).toISOString()
    }),
    operationCallerKey: 'trusted-local:runtime',
    workspace: taskWorkspace(directory),
    now,
    validate: () => undefined
  })
  await mkdir(record.workspace.canonicalPath)
  await mkdir(record.workspace.executionPath)
  const runtime = runtimeStub({ settings: {} })
  runtime.showTerminalWorkspaceLaunchScope.mockImplementation(async () => ({
    id: record.workspace.workspaceId,
    path: record.workspace.executionPath,
    connectionId: null,
    repo: null,
    folderWorkspace: null
  }))
  installedHost.mockReturnValue({ deps: { store } })
  let revoked = false
  const authorization = {
    workspace: record.workspace,
    input: 'Create report.md.',
    assertCurrent: () => {
      if (revoked) {
        throw new TaskExecutionError('FORBIDDEN')
      }
    }
  }
  const launch = createTaskAgentLaunchPort({
    context: () => rpcContext(runtime, {}),
    capabilities: () => [
      AGENT_LAUNCH_RUNTIME_CAPABILITY,
      AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY
    ]
  })
  return {
    record,
    runtime,
    authorization,
    launch,
    revoke: () => {
      revoked = true
    }
  }
}

describe('task authority across asynchronous agent replay preparation', () => {
  it('does not spawn after authority is revoked while installing the launch ledger', async () => {
    const current = await fixture()
    current.runtime.ensureStructuredAgentSessionHost.mockImplementationOnce(async () => {
      current.revoke()
    })
    await expect(current.launch(current.record, current.authorization)).rejects.toThrow('FORBIDDEN')
    expect(current.runtime.createTerminal).not.toHaveBeenCalled()
  })
  it('does not spawn when replay resolves the workspace to a different directory after admission', async () => {
    const current = await fixture()
    current.runtime.ensureStructuredAgentSessionHost.mockImplementationOnce(async () => {
      current.runtime.showTerminalWorkspaceLaunchScope.mockImplementation(async () => ({
        id: current.record.workspace.workspaceId,
        path: current.record.workspace.canonicalPath,
        connectionId: null,
        repo: null,
        folderWorkspace: null
      }))
    })
    await expect(current.launch(current.record, current.authorization)).rejects.toThrow('FORBIDDEN')
    expect(current.runtime.createTerminal).not.toHaveBeenCalled()
  })
  it('rechecks authority at the PTY request boundary after terminal preparation awaits', async () => {
    const current = await fixture()
    current.runtime.createTerminal.mockImplementationOnce(async (_selector, options) => {
      await Promise.resolve()
      current.revoke()
      const beforeSpawn = options?.onPtySpawnDispatched
      if (typeof beforeSpawn === 'function') {
        beforeSpawn({
          worktreeId: current.record.workspace.workspaceId,
          workspacePath: current.record.workspace.executionPath,
          connectionId: null,
          cwd: current.record.workspace.executionPath
        })
      }
      return { handle: 'term_1' }
    })
    await expect(current.launch(current.record, current.authorization)).rejects.toThrow('FORBIDDEN')
  })
  it.each(['host', 'workspace', 'directory', 'identity'] as const)(
    'rejects an actual spawn %s that differs from the admitted local workspace',
    async (changed) => {
      const current = await fixture()
      const spawn = vi.fn()
      current.runtime.createTerminal.mockImplementationOnce(async (_selector, options) => {
        await Promise.resolve()
        const beforeSpawn = options?.onPtySpawnDispatched
        if (typeof beforeSpawn === 'function') {
          beforeSpawn({
            worktreeId:
              changed === 'identity' ? 'another-workspace' : current.record.workspace.workspaceId,
            workspacePath:
              changed === 'workspace'
                ? current.record.workspace.canonicalPath
                : current.record.workspace.executionPath,
            connectionId: changed === 'host' ? 'ssh:another-host' : null,
            cwd:
              changed === 'directory'
                ? current.record.workspace.canonicalPath
                : current.record.workspace.executionPath
          })
        }
        spawn()
        return { handle: 'term_1' }
      })
      await expect(current.launch(current.record, current.authorization)).rejects.toThrow(
        'FORBIDDEN'
      )
      expect(spawn).not.toHaveBeenCalled()
    }
  )
  it('allows the unchanged admitted workspace at the actual spawn boundary', async () => {
    const current = await fixture()
    const spawn = vi.fn()
    current.runtime.createTerminal.mockImplementationOnce(async (_selector, options) => {
      await Promise.resolve()
      const beforeSpawn = options?.onPtySpawnDispatched
      if (typeof beforeSpawn === 'function') {
        beforeSpawn({
          worktreeId: current.record.workspace.workspaceId,
          workspacePath: current.record.workspace.executionPath,
          connectionId: null,
          cwd: current.record.workspace.executionPath
        })
      }
      spawn()
      return { handle: 'term_1' }
    })
    await expect(current.launch(current.record, current.authorization)).resolves.toMatchObject({
      worktreeId: current.record.workspace.workspaceId,
      outcome: { kind: 'terminal', handle: 'term_1' }
    })
    expect(spawn).toHaveBeenCalledOnce()
  })
})
