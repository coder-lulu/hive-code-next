import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { deriveAgentLaunchChildOperationId } from '../../shared/agent-launch-operation'
import { isAgentSessionRecord, type AgentSessionRecord } from '../../shared/agent-session-record'
import type { HiveWorkflowCaseView } from '../../shared/hive-workflow-cases'
import { syntheticWorkflowStageContext } from '../../shared/hive-workflow-cases.test-fixture'
import { taskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import { workflowTestVectors } from '../../shared/task-workflow/workflow.test-fixture'
import { emptyState } from '../runtime/agent-session-store-parsing'
import { admitTaskExecution } from './task-execution-admission'
import { taskCommand, TASK_TEST_NOW } from './task-execution.test-fixture'
import { TaskExecutionRecordSchema, type TaskExecutionRecord } from './task-execution-record'

export function caseSessionNativeFixture(
  view: HiveWorkflowCaseView,
  role: HiveWorkflowCaseView['stageTasks'][number]['role']
) {
  const stage = view.stageTasks.find((item) => item.role === role)!
  const context =
    role === 'tester'
      ? {
          ...syntheticWorkflowStageContext(
            view,
            view.stageTasks.find((item) => item.role === 'developer')!.stageRef
          ),
          stageRef: stage.stageRef,
          employeeRef: stage.employeeRef,
          role,
          codeInput: {
            producer: {
              ...workflowTestVectors.examples.handoff.producer,
              task: {
                ...workflowTestVectors.examples.handoff.producer.task,
                spaceId: view.binding.scope.companyRef
              }
            },
            version: {
              kind: 'snapshot' as const,
              snapshot: workflowTestVectors.examples.handoff.artifact,
              treeDigest: 'b'.repeat(64)
            }
          }
        }
      : syntheticWorkflowStageContext(view, stage.stageRef)
  const input = 'Synthetic original stage input'
  const inputDigest = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const command = taskCommand({
    executionAccountRef: view.team.company.ownerAccountRef,
    ownerScope: view.team.company.ownerScope,
    task: {
      spaceId: view.binding.scope.companyRef,
      taskId: stage.taskId,
      runId: randomUUID(),
      attempt: 1,
      taskRevision: '1'
    },
    workspaceRef: view.team.project.hiveWorkspaceRef,
    profileId: 'codex',
    profileRevision: 'codex:1',
    inputRef: `input:${inputDigest}`,
    workflowContext: context,
    expiresAt: '2000-01-01T00:00:00.000Z',
    executionDeadlineAt: '2000-01-01T00:00:00.000Z',
    executionPolicy: {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'docker-local-linux',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: `docker-enforcement:${'a'.repeat(64)}`
    }
  })
  const directory = resolve(
    'logs/paperclip-development/20261008-case-session/tmp/synthetic-execution'
  )
  const accepted = admitTaskExecution(emptyState('local'), {
    command,
    operationCallerKey: 'trusted-local:runtime',
    workspace: {
      hostId: 'local',
      workspaceId: 'folder:original-execution',
      canonicalPath: directory,
      executionPath: directory,
      isolation: 'managed_copy',
      ...(role === 'tester'
        ? {
            outputDirectory: {
              path: resolve(directory, 'tester-output'),
              directoryIdentity: { dev: '1', ino: '2', birthtimeNs: '3' }
            }
          }
        : {})
    },
    now: TASK_TEST_NOW,
    validate: () => undefined
  }).record
  let record: TaskExecutionRecord | null = TaskExecutionRecordSchema.parse({
    ...accepted,
    dispatch: 'dispatching',
    structuredBinding: {
      source: taskSessionSourceReference(accepted),
      operationCallerKey: accepted.operationCallerKey,
      operationId: command.operationId,
      attachOperationId: deriveAgentLaunchChildOperationId(command.operationId),
      launchFingerprint: 'a'.repeat(64),
      attachFingerprint: 'b'.repeat(64),
      sessionId: 'original-case-session',
      runtimeFence: 1,
      spawnToken: 'synthetic-original-spawn',
      accountHome: { variable: 'CODEX_HOME', path: directory },
      location: {
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: accepted.workspace.workspaceId,
        workspaceKind: 'folder'
      }
    }
  })
  let session: AgentSessionRecord | null = {
    schemaVersion: 2,
    sessionId: record.structuredBinding!.sessionId,
    location: record.structuredBinding!.location,
    provider: 'codex',
    providerHandleChain: [],
    accountHome: record.structuredBinding!.accountHome,
    taskSource: record.structuredBinding!.source,
    lease: {
      sessionId: record.structuredBinding!.sessionId,
      runtimeKind: 'native',
      runtimeFence: 2,
      handoffStage: null,
      provenHandleLinkId: null,
      ownerProcess: null,
      reservedSpawnToken: null,
      leaseDeadlineAt: 0,
      lastRenewedAt: 0,
      handoffOperationId: null,
      journalCheckpoint: null,
      claimKeyId: 'synthetic-original-key',
      claimStatus: 'released',
      unreconciled: true,
      deathEvidence: null
    },
    createdAt: TASK_TEST_NOW,
    updatedAt: TASK_TEST_NOW
  }
  if (!isAgentSessionRecord(session)) {
    throw new Error('Invalid synthetic original session')
  }
  return { command, context, input, inputDigest, record, session }
}
