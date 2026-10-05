import { mkdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { computeAgentLaunchFingerprint } from '../../shared/agent-launch-operation'
import { taskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { rpcContext, runtimeStub } from '../runtime/rpc/methods/agent-launch.test-fixture'
import {
  AGENT_LAUNCH_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import {
  taskCommand,
  taskTestDirectory,
  taskWorkspace,
  TASK_TEST_NOW,
  TASK_TEST_LAUNCH
} from './task-execution.test-fixture'

const { replay } = vi.hoisted(() => ({ replay: vi.fn() }))
vi.mock('../runtime/rpc/methods/agent-launch', () => ({
  AGENT_LAUNCH_METHODS: [{ name: 'agent.launchReplay', handler: replay }]
}))
const { createTaskAgentLaunchPort } = await import('./task-agent-launch-port')
let directory: string | undefined
afterEach(async () => {
  replay.mockReset()
  if (directory) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  directory = await taskTestDirectory()
  const store = await openTestAgentSessionRecordStore(directory)
  const record = (
    await store.tasks.admit({
      command: taskCommand(),
      operationCallerKey: 'trusted-local:runtime',
      workspace: taskWorkspace(directory),
      now: TASK_TEST_NOW,
      validate: () => undefined
    })
  ).record
  const runtime = runtimeStub({ settings: {} })
  await mkdir(record.workspace.canonicalPath)
  await mkdir(record.workspace.executionPath)
  runtime.showTerminalWorkspaceLaunchScope.mockImplementation(async () => ({
    id: record.workspace.workspaceId,
    path: record.workspace.executionPath,
    connectionId: null,
    repo: null,
    folderWorkspace: null
  }))
  const context = rpcContext(runtime, {})
  const options = {
    context: () => context,
    capabilities: () => [
      AGENT_LAUNCH_RUNTIME_CAPABILITY,
      AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY
    ]
  }
  const authorization = {
    workspace: taskWorkspace(directory),
    input: 'Create report.md.',
    assertCurrent: vi.fn()
  }
  replay.mockResolvedValue(TASK_TEST_LAUNCH)
  return { record, options, authorization, runtime }
}

describe('HiveCode task launch uses the installed replay port', () => {
  it('rejects an asynchronous original authorizer before preparing any launch', async () => {
    const { record, options, authorization, runtime } = await fixture()
    authorization.assertCurrent.mockImplementation(async () => undefined)
    await expect(
      createTaskAgentLaunchPort({ ...options, executor: 'codex' })(record, authorization)
    ).rejects.toThrow('FORBIDDEN')
    expect(runtime.showTerminalWorkspaceLaunchScope).not.toHaveBeenCalled()
    expect(replay).not.toHaveBeenCalled()
  })

  it('preserves synchronous authorization through the private origin wrapper', async () => {
    const { record, options, authorization } = await fixture()
    await createTaskAgentLaunchPort({ ...options, executor: 'codex' })(record, authorization)
    const [, context] = replay.mock.calls[0]
    authorization.assertCurrent.mockImplementation(async () => undefined)
    expect(() => context.taskLaunchOrigin.validate()).toThrow('FORBIDDEN')
  })

  it('rejects an async inherited current guard through the replay context wrapper', async () => {
    const { record, options, authorization } = await fixture()
    options.context().assertAgentLaunchCurrent = async () => undefined
    await createTaskAgentLaunchPort({ ...options, executor: 'codex' })(record, authorization)
    const [, context] = replay.mock.calls[0]
    expect(() =>
      context.assertAgentLaunchCurrent({
        agent: 'codex',
        target: {
          kind: 'existing',
          connectionId: null,
          worktree: record.workspace.workspaceId,
          workspacePath: record.workspace.executionPath
        },
        cwd: record.workspace.executionPath
      })
    ).toThrow('FORBIDDEN')
  })
  it('uses Codex with a required structured surface when selected by the host', async () => {
    const { record, options, authorization } = await fixture()
    await createTaskAgentLaunchPort({ ...options, executor: 'codex' })(record, authorization)
    expect(replay.mock.calls[0][0].agent).toBe('codex')
    expect(replay.mock.calls[0][1].requiredAgentLaunchMode).toBe('structured')
    const [params, context] = replay.mock.calls[0]
    expect(params).not.toHaveProperty('taskOrigin')
    expect(context.taskLaunchOrigin).toMatchObject({
      source: taskSessionSourceReference(record),
      operationCallerKey: record.operationCallerKey,
      operationId: record.command.operationId,
      launchFingerprint: computeAgentLaunchFingerprint(params)
    })
    authorization.assertCurrent.mockClear()
    context.taskLaunchOrigin.validate()
    expect(authorization.assertCurrent).toHaveBeenCalledOnce()
    authorization.assertCurrent.mockImplementation(() => {
      throw new Error('grant revoked')
    })
    expect(() => context.taskLaunchOrigin.validate()).toThrow('grant revoked')
  })
  it('keeps the stored operation/caller and requests a background builtin launch', async () => {
    const { record, options, authorization } = await fixture()
    await createTaskAgentLaunchPort(options)(record, authorization)
    expect(replay).toHaveBeenCalledTimes(1)
    expect(replay.mock.calls[0][0]).toMatchObject({
      agent: 'hivecode',
      operationId: record.command.operationId,
      presentation: 'background',
      agentArgs: null,
      target: { kind: 'existing', worktree: `id:${record.workspace.workspaceId}` }
    })
  })
  it('refuses missing replay capability without falling back to ordinary launch', async () => {
    const { record, options, authorization } = await fixture()
    options.capabilities = () => [AGENT_LAUNCH_RUNTIME_CAPABILITY]
    await expect(createTaskAgentLaunchPort(options)(record, authorization)).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(replay).not.toHaveBeenCalled()
  })
  it('refuses a context whose stable identity disagrees with the durable binding', async () => {
    const { record, options, authorization } = await fixture()
    record.operationCallerKey = 'service:different'
    await expect(createTaskAgentLaunchPort(options)(record, authorization)).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(replay).not.toHaveBeenCalled()
  })
  it('passes uncertainty through without a second id or second attempt', async () => {
    const { record, options, authorization } = await fixture()
    replay.mockRejectedValueOnce(new Error('agent_session_operation_unknown'))
    await expect(createTaskAgentLaunchPort(options)(record, authorization)).rejects.toThrow(
      'agent_session_operation_unknown'
    )
    expect(replay).toHaveBeenCalledTimes(1)
  })
  it('rejects a workspace id that resolves to the source directory instead of its isolated copy', async () => {
    const { record, options, authorization, runtime } = await fixture()
    runtime.showTerminalWorkspaceLaunchScope.mockImplementation(async () => ({
      id: record.workspace.workspaceId,
      path: record.workspace.canonicalPath,
      connectionId: null,
      repo: null,
      folderWorkspace: null
    }))
    await expect(createTaskAgentLaunchPort(options)(record, authorization)).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(replay).not.toHaveBeenCalled()
  })
  it('rejects a directory alias of the source even when the claimed execution path differs', async () => {
    const { record, options, authorization, runtime } = await fixture()
    const alias = join(directory!, 'source-alias')
    await symlink(record.workspace.canonicalPath, alias, 'junction')
    record.workspace.executionPath = alias
    authorization.workspace.executionPath = alias
    runtime.showTerminalWorkspaceLaunchScope.mockImplementation(async () => ({
      id: record.workspace.workspaceId,
      path: alias,
      connectionId: null,
      repo: null,
      folderWorkspace: null
    }))
    await expect(createTaskAgentLaunchPort(options)(record, authorization)).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(replay).not.toHaveBeenCalled()
  })
  it('rejects unsupported remote host bindings before replay dispatch', async () => {
    const { record, options, authorization } = await fixture()
    vi.spyOn(options.context().runtime, 'showTerminalWorkspaceLaunchScope').mockResolvedValue({
      id: record.workspace.workspaceId,
      path: record.workspace.executionPath,
      connectionId: 'ssh:connection-one',
      repo: null,
      folderWorkspace: null
    })
    await expect(createTaskAgentLaunchPort(options)(record, authorization)).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(replay).not.toHaveBeenCalled()
  })
  it('rejects a noncanonical claim path that aliases another execution directory', async () => {
    const { record, options, authorization, runtime } = await fixture()
    const alias = join(directory!, 'execution-alias')
    await symlink(record.workspace.executionPath, alias, 'junction')
    record.workspace.executionPath = alias
    authorization.workspace.executionPath = alias
    runtime.showTerminalWorkspaceLaunchScope.mockImplementation(async () => ({
      id: record.workspace.workspaceId,
      path: alias,
      connectionId: null,
      repo: null,
      folderWorkspace: null
    }))
    await expect(createTaskAgentLaunchPort(options)(record, authorization)).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(replay).not.toHaveBeenCalled()
  })
})
