import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import { taskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import type { StructuredAgentSessionCaller } from '../native-chat/agent-session-wire/structured-agent-session-host-types'
import {
  reserveRequestFor,
  type AgentSessionAttachParams
} from '../native-chat/agent-session-wire/structured-agent-session-attach'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import {
  rpcContext,
  runtimeStub,
  setAgentLaunchRecordStore
} from '../runtime/rpc/methods/agent-launch.test-fixture'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { TaskExecutionError } from './task-execution-error'
import { taskCommand, taskWorkspace } from './task-execution.test-fixture'
import { taskAgentLaunchParams } from './task-agent-launch-params'

const { installedHost } = vi.hoisted(() => ({ installedHost: vi.fn() }))
vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: installedHost
}))
const { createTaskAgentLaunchPort } = await import('./task-agent-launch-port')
const { AGENT_LAUNCH_METHODS } = await import('../runtime/rpc/methods/agent-launch')
let directory: string | undefined
afterEach(async () => {
  installedHost.mockReset()
  setAgentLaunchRecordStore(null)
  if (directory) {
    closeTestJournalHostDatabases()
    await rm(directory, { recursive: true, force: true })
  }
  directory = undefined
})

async function fixture() {
  const logs = resolve('logs/paperclip-development/p3/task-session-binding/verification/launch/tmp')
  await mkdir(logs, { recursive: true })
  directory = await mkdtemp(join(logs, 'launch-'))
  const now = Date.now()
  const store = await openTestAgentSessionRecordStore(directory)
  setAgentLaunchRecordStore(store)
  const command = taskCommand({
    operationId: `${now}-${'b'.repeat(32)}`,
    expiresAt: new Date(now + 60_000).toISOString()
  })
  const workspace = taskWorkspace(directory)
  await mkdir(workspace.canonicalPath)
  await mkdir(workspace.executionPath)
  await store.tasks.admit({
    command,
    operationCallerKey: 'trusted-local:runtime',
    workspace,
    now,
    validate: () => undefined
  })
  const { record } = await store.tasks.beginDispatch(command, now, () => undefined)
  const resolved = (
    args: Parameters<OrcaRuntimeService['resolveStructuredAgentSessionCreateIntent']>[0]
  ): AgentSessionAttachParams => ({
    envelope: { ...args.envelope, expectedRuntimeFence: null, payloadFingerprint: '' },
    provider: 'codex',
    agent: 'codex',
    runtimeKind: 'native',
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: workspace.workspaceId,
      workspaceKind: 'folder'
    },
    accountHome: { variable: 'CODEX_HOME', path: '/test/managed-codex-home' }
  })
  const runtime = {
    ...runtimeStub(),
    resolveStructuredAgentSessionCreateIntent: vi.fn(async (args: Parameters<typeof resolved>[0]) =>
      resolved(args)
    ),
    publishStructuredAgentSessionTab: vi.fn(async () => {})
  }
  runtime.showTerminalWorkspaceLaunchScope.mockImplementation(async () => ({
    id: workspace.workspaceId,
    path: workspace.executionPath,
    connectionId: null,
    repo: null,
    folderWorkspace: null
  }))
  const attach = vi.fn(
    async (caller: StructuredAgentSessionCaller, params: AgentSessionAttachParams) => {
      const reserved = await store.reserveOwner(
        reserveRequestFor({
          sessionId: params.envelope.sessionId,
          params,
          callerKey: caller.callerKey,
          fingerprint: params.envelope.payloadFingerprint,
          now: Date.now(),
          authority: {
            spawnToken: 'test-launch-token',
            claimKeyId: 'test-launch-key',
            handoffOperationId: params.envelope.clientOperationId,
            probe: { outcome: 'reservation-unused' }
          }
        })
      )
      return {
        ok: true,
        value: { sessionId: reserved.record.sessionId, fence: reserved.record.lease.runtimeFence }
      }
    }
  )
  installedHost.mockReturnValue({
    deps: { store },
    attach,
    send: vi.fn(async () => ({ ok: true, value: { clientMessageId: 'test-launch-message' } }))
  })
  const assertCurrent = () => {
    const current = store.tasks.get(command)
    if (
      !current ||
      current.dispatch !== 'dispatching' ||
      current.cancellationKey ||
      current.result
    ) {
      throw new TaskExecutionError('FORBIDDEN')
    }
  }
  const authorization = {
    workspace,
    input: 'Create report.md.',
    assertCurrent,
    dispatch: { prepare: async () => undefined, assertCurrent }
  }
  const launch = createTaskAgentLaunchPort({
    context: () => rpcContext(runtime, {}),
    executor: 'codex',
    capabilities: () => [
      AGENT_LAUNCH_RUNTIME_CAPABILITY,
      AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY
    ]
  })
  return { store, command, record, resolved, runtime, attach, authorization, launch }
}

describe('Task source through the original replay/create/attach path', () => {
  it('passes host provenance through prepare, preserves the caller and replays without a second reservation', async () => {
    const f = await fixture()
    const result = await f.launch(f.record, f.authorization)
    expect(result.outcome.kind).toBe('structured')
    expect(f.attach).toHaveBeenCalledOnce()
    const [caller, params] = f.attach.mock.calls[0]
    expect(caller.callerKey).toBe(f.record.operationCallerKey)
    expect(params.taskOrigin?.source).toEqual(taskSessionSourceReference(f.record))
    expect(params.taskOrigin?.validate).toEqual(expect.any(Function))
    const bound = f.store.tasks.get(f.command)
    expect(bound?.structuredBinding).toMatchObject({
      source: taskSessionSourceReference(f.record),
      sessionId: params.envelope.sessionId,
      accountHome: params.accountHome,
      attachOperationId: params.envelope.clientOperationId,
      attachFingerprint: params.envelope.payloadFingerprint
    })
    expect(await f.launch(f.record, f.authorization)).toEqual(result)
    expect(f.attach).toHaveBeenCalledOnce()
    expect(f.runtime.resolveStructuredAgentSessionCreateIntent).toHaveBeenCalledOnce()
    expect(f.store.tasks.get(f.command)).toEqual(bound)
    await f.store.tasks.bindLaunch(f.store.tasks.get(f.command)!, result, Date.now())
    expect(f.store.tasks.get(f.command)?.dispatch).toBe('bound')
    expect(f.runtime.createTerminal).not.toHaveBeenCalled()
  })

  it('cannot reserve or fall back to a terminal after Task cancellation while create intent awaits', async () => {
    const f = await fixture()
    f.runtime.resolveStructuredAgentSessionCreateIntent.mockImplementation(async (args) => {
      await f.store.tasks.requestCancellation(
        f.command,
        'cancel:create',
        Date.now(),
        () => undefined
      )
      return f.resolved(args)
    })
    await expect(f.launch(f.record, f.authorization)).rejects.toThrow()
    expect(f.store.tasks.get(f.command)?.cancellationKey).toBe('cancel:create')
    expect(f.store.tasks.get(f.command)?.structuredBinding).toBeUndefined()
    expect(f.store.listRecords()).toHaveLength(0)
    expect(f.runtime.createTerminal).not.toHaveBeenCalled()
  })

  it('does not accept a host-origin callback from launch request JSON', async () => {
    const f = await fixture()
    const method = AGENT_LAUNCH_METHODS.find((entry) => entry.name === 'agent.launchReplay')
    if (!method) {
      throw new Error('The original launch replay method is missing.')
    }
    const parsed = method.params.safeParse({
      ...taskAgentLaunchParams(f.record, f.authorization.input, 'codex'),
      taskOrigin: { source: taskSessionSourceReference(f.record), validate: 'forged' }
    })
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('taskOrigin')
    }
    expect(f.attach).not.toHaveBeenCalled()
  })
})
