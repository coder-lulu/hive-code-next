import { join, resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { nativeWorkflowCapacityFixture } from './local-task-workflow-capacity.test-fixture'
import { planPrepareFixture } from './local-task-plan-prepare.test-fixture'
import {
  LocalTaskBindingInputSchema,
  localTaskBindingKey,
  readLocalTaskBinding
} from './local-task-binding-file'
import { workflowOutcomeFixture } from './task-workflow-outcome.test-fixture'
import { TaskWorkflowOutcomeStore } from './task-workflow-outcome-store'
import { TaskCodeSnapshotStore } from './task-code-snapshot'
import { TaskExecutionHost } from './task-execution-host'
import { assertTaskDockerEnforcementCommand } from './task-docker-enforcement'
import { JsonTextStructureValidator } from '../../shared/json-text-structure-limit'
import { createLocalTaskAuthorizer } from './local-task-authority'
import { taskCapabilities } from './task-execution.test-fixture'
import { taskExecutionIdentity } from './task-execution-record'
import { taskAgentLaunchParams } from './task-agent-launch-params'
import { startLocalTaskTransport } from './local-task-transport'
import { LocalTaskClient } from './local-task-client'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS } from '../../shared/hive-workflow-plan-response-budget'
import {
  TASK_NATIVE_DEFAULT_MAX_BYTES,
  TASK_WORKFLOW_NATIVE_MAX_BYTES
} from '../../shared/task-execution/task-native-transport-limits'

it('round trips 31 original dependencies through issuer, authenticated HTTP, native outcome and durable intent', async () => {
  const parent = resolve('logs/paperclip-development/20261011-plan-graph/main/review-fixes')
  const f = await planPrepareFixture(parent)
  const capacity = nativeWorkflowCapacityFixture()
  const input = LocalTaskBindingInputSchema.parse({
    paperclipCompanyId: capacity.task.spaceId,
    paperclipAgentId: capacity.context.employeeRef,
    task: capacity.task,
    workspaceSelector: f.admission.workspaceSelector,
    input: '\u0001'.repeat(HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS),
    executionMode: 'enforced_autonomous',
    executionDeadlineAt: new Date(Date.now() + 120_000).toISOString(),
    workflowContext: capacity.context
  })
  const binding = await f.issuer.issue(input)
  const grant = f.issuer.resolveGrant(binding.command.authorizationRef)!
  const native = await workflowOutcomeFixture({
    command: binding.command,
    workspace: grant.workspace,
    context: capacity.context,
    caseView: capacity.source.caseView,
    task: capacity.task,
    operationCallerKey: f.caller.operationCallerKey,
    evidenceRoot: parent
  })
  const outcomes = new TaskWorkflowOutcomeStore({
    directory: native.directory,
    artifacts: native.artifacts,
    snapshots: new TaskCodeSnapshotStore(native.directory),
    collectCommands: async () => ({ kind: 'unavailable', reason: 'journal_unavailable' })
  })
  const launch = vi.fn(async () => {
    throw new Error('Terminal replay must not launch')
  })
  const host = new TaskExecutionHost({
    store: native.store.tasks,
    authorize: createLocalTaskAuthorizer({
      ...f.issuerOptions,
      resolveGrant: f.issuer.resolveGrant
    }),
    authorizeEnforcement: async (command, action) => {
      if (action === 'start') {
        assertTaskDockerEnforcementCommand(command, await f.issuerOptions.resolveEnforcement())
      }
    },
    capabilities: () => taskCapabilities(binding.command),
    launch,
    collect: async () => null,
    stop: async () => {
      throw new Error('Must not stop')
    },
    workflowOutcomes: outcomes
  })
  const transport = await startLocalTaskTransport({
    host,
    capabilities: () => taskCapabilities(binding.command),
    authenticate: (bearer) => (f.credential.authenticate(bearer) ? f.caller : null),
    resolveBinding: (company, run, purpose, caller) =>
      f.issuer.resolveBinding(company, run, caller.operationCallerKey, purpose)
  })
  const client = new LocalTaskClient({ baseUrl: transport.baseUrl, secret: f.credential.secret })
  try {
    expect(Buffer.byteLength(JSON.stringify(binding.command))).toBeGreaterThan(
      TASK_NATIVE_DEFAULT_MAX_BYTES
    )
    expect(
      await client.binding(input.paperclipCompanyId, input.task.runId, 'execute')
    ).toMatchObject({
      commandFingerprint: binding.commandFingerprint,
      command: { workflowContext: capacity.context }
    })
    await client.start(binding.command, binding.commandFingerprint)
    const query = {
      ...taskExecutionIdentity(binding.command),
      kind: 'workflow.outcome.read' as const,
      commandFingerprint: binding.commandFingerprint,
      authorizationRef: binding.command.authorizationRef,
      authorizationRevision: binding.command.authorizationRevision,
      expiresAt: binding.command.expiresAt
    }
    const outcome = await client.workflowOutcome(query)
    expect(Buffer.byteLength(JSON.stringify(outcome))).toBeGreaterThan(
      TASK_NATIVE_DEFAULT_MAX_BYTES
    )
    expect(await client.workflowOutcome(query)).toEqual(outcome)
    const restored = await readLocalTaskBinding({
      directory: f.directory,
      key: localTaskBindingKey(input.paperclipCompanyId, input.task.runId),
      operationCallerKey: f.caller.operationCallerKey,
      readExecution: (command) => native.store.tasks.get(command)
    })
    expect(restored.input).toEqual(input)
    expect(taskAgentLaunchParams(native.record, input.input, 'codex').prompt?.text).toBe(
      input.input
    )
    expect(
      LocalTaskBindingInputSchema.safeParse({ ...input, workflowContext: undefined }).success
    ).toBe(false)
    const headers = {
      Authorization: `Bearer ${f.credential.secret}`,
      'Content-Type': 'application/json'
    }
    const invalid = await fetch(`${transport.baseUrl}/execution/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...binding.command, extra: 'forbidden' })
    })
    expect(invalid.status).toBe(413)
    const oversize = await fetch(`${transport.baseUrl}/execution/start`, {
      method: 'POST',
      headers,
      body: ' '.repeat(TASK_WORKFLOW_NATIVE_MAX_BYTES + 1)
    })
    expect(oversize.status).toBe(413)
    for (const body of [`${'['.repeat(17)}0${']'.repeat(17)}`, `[${'0,'.repeat(65_536)}0]`]) {
      const response = await fetch(`${transport.baseUrl}/execution/start`, {
        method: 'POST',
        headers,
        body
      })
      expect([400, 413]).toContain(response.status)
    }
    const ordinary = { ...binding.command, workflowContext: undefined }
    const ordinaryResponse = await fetch(`${transport.baseUrl}/execution/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify(ordinary) + ' '.repeat(TASK_NATIVE_DEFAULT_MAX_BYTES)
    })
    expect(ordinaryResponse.status).toBe(413)
    expect(launch).not.toHaveBeenCalled()
    const structures = [binding.command, binding, outcome].map((value) => {
      const validator = new JsonTextStructureValidator({
        structuralTokens: 65_536,
        nestingDepth: 16
      })
      validator.consume(JSON.stringify(value))
      return validator.usage()
    })
    await writeFile(
      join(parent, 'native-capacity.json'),
      JSON.stringify(
        {
          contextBytes: Buffer.byteLength(JSON.stringify(capacity.context)),
          commandBytes: Buffer.byteLength(JSON.stringify(binding.command)),
          bindingBytes: Buffer.byteLength(JSON.stringify(binding)),
          outcomeBytes: Buffer.byteLength(JSON.stringify(outcome)),
          promptCharacters: input.input.length,
          intentInputBytes: Buffer.byteLength(JSON.stringify(input)),
          structures
        },
        null,
        2
      )
    )
  } finally {
    await transport.close()
    await host.drain()
    closeTestJournalHostDatabase(join(native.root, 'records'))
    await f.close()
  }
}, 30_000)
