import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { dockerSessionFixture, dockerOwnerRunner } from './task-docker-session-owner.test-fixture'
import { createTaskDockerSessionOwner } from './task-docker-session-owner'
import { createTaskCodexModelChannel } from './task-codex-model-channel'
import { openTaskDockerCodexConnection } from './task-docker-codex-connection'
import { createTaskCodexEvidence } from './task-codex-evidence'
import { TaskExecutionHost } from './task-execution-host'
import { taskCapabilities, TASK_TEST_NOW } from './task-execution.test-fixture'
import { modelStartParams, modelRequestBody } from './task-model-broker.test-fixture'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { indexProviderChild } from '../native-chat/agent-session-wire/structured-agent-session-provider-child'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { openTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import type { CodexAppServerConnection } from '../codex/codex-app-server-connection'

export async function fatalModelFixture() {
  const f = await dockerSessionFixture(
    true,
    true,
    resolve('logs/paperclip-development/p3/task-fatal-model-settlement/author/tmp')
  )
  const binding = f.store.tasks.get(f.command)!.structuredBinding!
  const launch = {
    worktreeId: f.task.workspace.workspaceId,
    outcome: { kind: 'structured' as const, sessionId: binding.sessionId, handle: 'fatal-test' },
    receipt: {
      mode: 'structured' as const,
      preferred: 'structured' as const,
      reason: 'user_default' as const,
      detail: 'Synthetic original owner.'
    }
  }
  await f.store.tasks.bindLaunch(f.store.tasks.get(f.command)!, launch, TASK_TEST_NOW)
  const original = f.store.tasks.get(f.command)!
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(
        'data: {"type":"response.created","response":{"id":"resp-fatal","private-key":"synthetic"}}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
  )
  const channel = createTaskCodexModelChannel({
    store: f.store,
    binding,
    deadline: TASK_TEST_NOW + 120_000,
    account: {
      accountId: 'synthetic',
      codexHome: binding.accountHome.path,
      providerAccountId: 'synthetic-fatal',
      assertCurrent: f.validate,
      assertMetadataCurrent: f.validate
    },
    assertCurrent: () => f.store.tasks.assertStructuredBindingCurrent(binding),
    readAuth: async () => ({
      Authorization: 'Bearer synthetic',
      'ChatGPT-Account-Id': 'synthetic-fatal'
    }),
    request
  })
  let positive = false
  const stopBoundary = vi.fn(async () => positive)
  const raw: CodexAppServerConnection = {
    pid: undefined,
    closed: false,
    request: vi.fn(async () => ({})),
    notify: vi.fn(),
    respond: vi.fn(),
    respondWithError: vi.fn(),
    close: vi.fn(async () => true)
  }
  const onExit = vi.fn<(error?: unknown) => void>()
  const connection = await openTaskDockerCodexConnection({
    boundary: {
      prepare: async () => ({
        containerId: f.pending.containerId!,
        launch: {
          command: '/synthetic',
          args: [],
          cwd: f.directory,
          env: {},
          environmentMode: 'replace' as const
        },
        assertCurrent: f.validate
      }),
      inspect: async () => (positive ? 'exited' : 'live'),
      stop: stopBoundary
    },
    modelChannel: channel,
    open: async () => raw,
    handlers: { onExit }
  })
  const runner = dockerOwnerRunner(f)
  const owner = createTaskDockerSessionOwner({ store: f.store, run: runner.run })
  const acquire = vi.fn(async () => {
    throw new Error('Fatal settlement cannot acquire')
  })
  const disposeSession = vi.fn(() => connection.close())
  const host = new StructuredAgentSessionHost({
    store: f.store,
    adapter: {
      acquire,
      dispatch: vi.fn(async () => ({ state: 'unknown' as const, reason: 'synthetic' })),
      cancelTurn: async () => ({ cancelled: false }),
      answerPrompt: async () => undefined,
      setOption: async () => undefined,
      disposeSession,
      releaseAcquisition: () => connection.close()
    },
    journalDatabase: openTestJournalHostDatabase(f.directory),
    claimKeyId: 'fatal-model-test',
    now: () => TASK_TEST_NOW,
    stopExecutionOwner: owner.stop,
    probeOwner: async (record) =>
      (await owner.probe(record)) ?? { outcome: 'execution-host-unverifiable' }
  })
  setStructuredAgentSessionHost(host)
  await host.journalSnapshot(binding.sessionId)
  indexProviderChild(host.collaboratorsForTests().sessions.get(binding.sessionId)!, {
    generation: 'fatal-original-child',
    fence: binding.runtimeFence,
    phase: 'ready'
  })
  const evidence = createTaskCodexEvidence(resolve(f.directory, 'artifacts'))
  const launchAgain = vi.fn(async () => {
    throw new Error('Fatal settlement cannot relaunch')
  })
  const taskHost = new TaskExecutionHost({
    store: f.store.tasks,
    ...evidence,
    capabilities: taskCapabilities,
    launch: launchAgain,
    now: () => TASK_TEST_NOW,
    authorize: async () => ({
      workspace: original.workspace,
      input: 'Synthetic original input',
      assertCurrent: f.validate
    })
  })
  const profile = taskDockerModelProfile()
  const params = modelStartParams({
    ...modelRequestBody,
    model: profile.model,
    instructions: '',
    tools: undefined,
    input: [{ type: 'additional_tools', role: 'developer', tools: profile.approvedTools }],
    parallel_tool_calls: false,
    reasoning: { effort: 'low', context: 'all_turns' }
  })
  const reconcile = () =>
    taskHost.reconcile(
      {
        kind: 'execution.reconcile',
        protocolVersion: 1,
        runtimeRecordId: f.command.runtimeRecordId,
        ownershipEpoch: f.command.ownershipEpoch,
        executionId: f.command.executionId,
        executionEpoch: f.command.executionEpoch,
        commandFingerprint: original.commandFingerprint,
        authorizationRef: f.command.authorizationRef,
        authorizationRevision: f.command.authorizationRevision,
        expiresAt: f.command.expiresAt
      },
      { operationCallerKey: original.operationCallerKey }
    )
  const fatal = async () => {
    await channel.start(params)
    let error: unknown
    try {
      await channel.next({ requestId: params.requestId, sequence: 0 })
    } catch (failure) {
      error = failure
    }
    await vi.waitFor(() => expectClosed())
    return error
  }
  const expectClosed = () => {
    if (vi.mocked(raw.close).mock.calls.length === 0) {
      throw new Error('Original cleanup has not run')
    }
  }
  return {
    ...f,
    original,
    binding,
    channel,
    connection,
    raw,
    onExit,
    request,
    stopBoundary,
    runner,
    host,
    taskHost,
    evidence,
    acquire,
    disposeSession,
    launchAgain,
    params,
    reconcile,
    fatal,
    allowStop: () => {
      positive = true
    },
    requestId: randomUUID()
  }
}
