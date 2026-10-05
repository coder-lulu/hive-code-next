import { rm } from 'node:fs/promises'
import { vi } from 'vitest'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { TaskExecutionHost, type TaskExecutionHostDependencies } from './task-execution-host'
import { startLocalTaskTransport } from './local-task-transport'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { LocalTaskClient } from './local-task-client'
import type {
  HiveRuntimeAdapterPorts,
  PaperclipTaskExecutionContext
} from './paperclip-adapter-contract'
import {
  taskCommand,
  taskCapabilities,
  taskWorkspace,
  taskStopEvidence,
  taskTestDirectory,
  TASK_TEST_CALLER,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

/** A protocol fixture with real HTTP and disk commits; provider/stop ports are explicit test doubles. */
export async function taskAdapterFixture() {
  const directory = await taskTestDirectory()
  const command = taskCommand()
  const store = await openTestAgentSessionRecordStore(directory)
  const deps: TaskExecutionHostDependencies = {
    store: store.tasks,
    now: () => TASK_TEST_NOW,
    capabilities: () => taskCapabilities(),
    authorize: vi.fn(async () => ({
      workspace: taskWorkspace(directory),
      input: 'Private fixture input.',
      assertCurrent: () => undefined
    })),
    launch: vi.fn(async () => TASK_TEST_LAUNCH),
    collect: vi.fn(async () => null),
    stop: vi.fn(async (record) => taskStopEvidence(record)),
    evidenceTimeoutMs: 5000
  }
  const host = new TaskExecutionHost(deps)
  const credential = createLocalTaskServiceCredential(TASK_TEST_CALLER.operationCallerKey)
  const transport = await startLocalTaskTransport({
    host,
    authenticate: credential.authenticate,
    capabilities: () => taskCapabilities()
  })
  const client = new LocalTaskClient({ baseUrl: transport.baseUrl, secret: credential.secret })
  const binding = {
    bindingRef: 'binding:test',
    paperclipCompanyId: 'company:test',
    paperclipAgentId: 'agent:test',
    command,
    commandFingerprint: computeTaskExecutionFingerprint(
      command,
      TASK_TEST_CALLER.operationCallerKey
    )
  }
  const controller = new AbortController()
  const context: PaperclipTaskExecutionContext = {
    runId: command.task.runId,
    agent: {
      id: binding.paperclipAgentId,
      companyId: binding.paperclipCompanyId,
      adapterType: 'hive_runtime'
    },
    config: {
      workspaceRef: command.workspaceRef,
      profileId: command.profileId,
      profileRevision: command.profileRevision
    },
    runtime: { taskKey: command.task.taskId, sessionParams: null },
    signal: controller.signal,
    onCancellationReady: vi.fn(async () => undefined),
    onDispatch: vi.fn(),
    onLog: vi.fn(async () => undefined)
  }
  const ports: HiveRuntimeAdapterPorts = {
    client,
    resolveBinding: vi.fn(async () => binding),
    pollIntervalMs: 10,
    waitTimeoutMs: 2000
  }
  const query = {
    protocolVersion: command.protocolVersion,
    runtimeRecordId: command.runtimeRecordId,
    ownershipEpoch: command.ownershipEpoch,
    executionId: command.executionId,
    executionEpoch: command.executionEpoch,
    commandFingerprint: binding.commandFingerprint,
    authorizationRef: command.authorizationRef,
    authorizationRevision: command.authorizationRevision,
    expiresAt: command.expiresAt,
    kind: 'execution.reconcile'
  }
  return {
    directory,
    deps,
    host,
    store,
    client,
    credential,
    binding,
    controller,
    context,
    ports,
    query,
    transport,
    async close() {
      await transport.close()
      await host.drain()
      closeTestJournalHostDatabase(directory)
      await rm(directory, { recursive: true, force: true })
    }
  }
}
