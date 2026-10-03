import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  TaskExecutionStartSchema,
  type TaskExecutionStart
} from '../../shared/task-execution/task-execution-command'
import {
  AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'
import {
  TASK_EXECUTION_CAPABILITY,
  TASK_WORKSPACE_CLAIM_CAPABILITY,
  TASK_STOP_PROOF_CAPABILITY
} from '../../shared/task-execution/task-execution-primitives'
import type { AgentLaunchResult } from '../../shared/agent-launch-intent'
import type { TaskExecutionRecord, TaskExecutionWorkspace } from './task-execution-record'
import type { TaskExecutionStopEvidence } from './task-execution-host'

export const TASK_TEST_NOW = 1_800_000_000_000
export const TASK_TEST_CALLER = { operationCallerKey: 'service:local-test' }
export function taskCommand(patch: Partial<TaskExecutionStart> = {}): TaskExecutionStart {
  const vectors = JSON.parse(
    readFileSync(resolve('integration/contracts/v1/test-vectors.json'), 'utf8')
  )
  return TaskExecutionStartSchema.parse({
    ...vectors.examples.start,
    expiresAt: new Date(TASK_TEST_NOW + 60_000).toISOString(),
    ...patch
  })
}
export async function taskTestDirectory() {
  const root = resolve('logs/paperclip-p1/tmp')
  await mkdir(root, { recursive: true })
  return mkdtemp(join(root, 'task-execution-'))
}
export function taskWorkspace(root: string): TaskExecutionWorkspace {
  return {
    hostId: 'local',
    workspaceId: 'local-test-workspace',
    canonicalPath: join(root, 'user'),
    executionPath: join(root, 'execution'),
    isolation: 'managed_copy'
  }
}
export function taskCapabilities(command = taskCommand()) {
  return {
    protocolVersion: 1,
    kind: 'execution.capabilities',
    runtimeRecordId: command.runtimeRecordId,
    ownershipEpoch: command.ownershipEpoch,
    host: 'native',
    capabilities: [
      TASK_EXECUTION_CAPABILITY,
      TASK_WORKSPACE_CLAIM_CAPABILITY,
      TASK_STOP_PROOF_CAPABILITY,
      AGENT_LAUNCH_RUNTIME_CAPABILITY,
      AGENT_LAUNCH_REPLAY_REQUIRED_RUNTIME_CAPABILITY,
      ...command.requiredCapabilities
    ],
    resourceCoverage: [],
    manifestVersions: [],
    resolverVersions: []
  }
}
export function taskStopEvidence(record: TaskExecutionRecord): TaskExecutionStopEvidence {
  return {
    runtimeRecordId: record.command.runtimeRecordId,
    ownershipEpoch: record.command.ownershipEpoch,
    commandFingerprint: record.commandFingerprint,
    executionId: record.command.executionId,
    executionEpoch: record.command.executionEpoch,
    workspaceExecutionClaimRef: record.command.workspaceExecutionClaimRef,
    writeFence: record.command.writeFence,
    operationId: record.command.operationId,
    operationCallerKey: record.operationCallerKey,
    evidenceKind: record.dispatch === 'not_dispatched' ? 'not_started' : 'stopped',
    managedToolsSettled: true,
    writersFenced: true
  }
}
export const TASK_TEST_LAUNCH: AgentLaunchResult = {
  worktreeId: 'local-test-workspace',
  outcome: { kind: 'terminal', handle: 'term_test' },
  receipt: {
    mode: 'terminal',
    preferred: 'terminal',
    reason: 'agent_without_structured_session',
    detail: 'Test host fixture.'
  }
}
