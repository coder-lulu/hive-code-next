import { createHash } from 'node:crypto'
import { constants, lstatSync, realpathSync, type Stats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import { readNodeFileHandleWithinLimit } from '../../shared/node-bounded-file-reader'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import {
  TaskOpaqueRef,
  TaskRefSchema,
  TaskTimestamp
} from '../../shared/task-execution/task-execution-primitives'
import { HiveRuntimeAdapterBinding } from './paperclip-adapter-contract'
import { TaskExecutionWorkspaceSchema, type TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'
import { taskLaunchPathKey } from './task-launch-workspace'
import { assertTaskDirectoryIdentity } from './task-managed-copy'
import { isTaskDockerEnforcementPolicy } from './task-docker-enforcement'
import { WorkflowExecutionContextSchema } from '../../shared/task-workflow/workflow-execution-context'
import { assertTaskOutputWorkspace } from './task-output-workspace'
import {
  HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS,
  HIVE_WORKFLOW_PLAN_RUN_RESPONSE_BYTES
} from '../../shared/hive-workflow-plan-response-budget'

export const LocalTaskBindingInputSchema = z
  .strictObject({
    paperclipCompanyId: TaskOpaqueRef,
    paperclipAgentId: TaskOpaqueRef,
    task: TaskRefSchema,
    workspaceSelector: z.string().min(1).max(512),
    input: z.string().min(1).max(HIVE_WORKFLOW_PLAN_RUN_INPUT_CHARACTERS),
    executionMode: z.literal('enforced_autonomous').optional(),
    executionDeadlineAt: TaskTimestamp.optional(),
    workflowContext: WorkflowExecutionContextSchema.optional()
  })
  .refine(
    (input) => input.workflowContext?.planExecution !== undefined || input.input.length <= 128_000,
    'Only an adopted workflow plan may supply an expanded prompt.'
  )
  .refine(
    (input) =>
      input.executionDeadlineAt === undefined || input.executionMode === 'enforced_autonomous',
    'Only enforced tasks may supply an execution deadline.'
  )
  .refine(
    (input) => input.executionMode === 'enforced_autonomous' || input.input.length <= 48_000,
    'Personal task input exceeds its limit.'
  )
  .refine(
    (input) => input.task.spaceId === input.paperclipCompanyId,
    'Task company does not match its binding.'
  )
  .refine(
    (input) =>
      !input.workflowContext ||
      (input.executionMode === 'enforced_autonomous' &&
        input.executionDeadlineAt !== undefined &&
        input.workflowContext.binding.scope.companyRef === input.paperclipCompanyId &&
        input.workflowContext.employeeRef === input.paperclipAgentId),
    'Workflow input must match its controlled company and employee binding.'
  )
export type LocalTaskBindingInput = z.infer<typeof LocalTaskBindingInputSchema>
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const StoredBinding = z.strictObject({
  binding: HiveRuntimeAdapterBinding,
  workspace: TaskExecutionWorkspaceSchema,
  accountId: z.string().min(1).max(512),
  authorityId: z.string().min(1).max(512),
  sessionGeneration: z.number().int().nonnegative(),
  fingerprint: Fingerprint
})
const Intent = z.strictObject({ fingerprint: Fingerprint, input: LocalTaskBindingInputSchema })
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const localTaskBindingKey = (companyId: string, runId: string) => digest([companyId, runId])
export type RecoveredLocalTaskBinding = z.infer<typeof StoredBinding> & {
  key: string
  input: LocalTaskBindingInput
  assertCurrent(): void
}
function sameFile(before: Stats, after: Stats) {
  return (
    !after.isSymbolicLink() &&
    after.isFile() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  )
}
async function readBindingFile(path: string, maximumBytes = 1024 * 1024) {
  const before = await lstat(path)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (process.platform !== 'win32' && (before.mode & 0o077) !== 0)
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const read = await readNodeFileHandleWithinLimit(file, maximumBytes)
    if (!sameFile(before, read.stats) || !sameFile(before, await lstat(path))) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    const value: unknown = JSON.parse(read.buffer.toString('utf8'))
    return {
      value,
      assertCurrent: () => {
        if (!sameFile(before, lstatSync(path))) {
          return refuseTaskExecution('FORBIDDEN')
        }
      }
    }
  } finally {
    await file.close()
  }
}

/** Durable files supply evidence only; current identity must issue a new limited grant. */
export async function readLocalTaskBinding(options: {
  directory: string
  key: string
  operationCallerKey: string
  readExecution(command: TaskExecutionRecord['command']): TaskExecutionRecord | null
}): Promise<RecoveredLocalTaskBinding> {
  Fingerprint.parse(options.key)
  const directory = join(options.directory, 'bindings')
  const canonical = await realpath(directory)
  const assertDirectory = () => {
    if (
      lstatSync(directory).isSymbolicLink() ||
      taskLaunchPathKey(realpathSync(directory)) !== taskLaunchPathKey(canonical)
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
  }
  assertDirectory()
  const [bindingFile, intentFile] = await Promise.all([
    readBindingFile(join(canonical, `${options.key}.json`)),
    readBindingFile(
      join(canonical, `${options.key}.intent.json`),
      HIVE_WORKFLOW_PLAN_RUN_RESPONSE_BYTES
    )
  ])
  const stored = StoredBinding.parse(bindingFile.value)
  const intent = Intent.parse(intentFile.value)
  const record = options.readExecution(stored.binding.command)
  const workspaceRoot = await realpath(join(options.directory, 'workspaces'))
  const suffix = relative(workspaceRoot, stored.workspace.executionPath)
  const accountRef = `account:${digest(stored.accountId)}`
  if (
    !record ||
    record.operationCallerKey !== options.operationCallerKey ||
    computeTaskExecutionFingerprint(stored.binding.command, options.operationCallerKey) !==
      record.commandFingerprint ||
    stored.binding.commandFingerprint !== record.commandFingerprint ||
    canonicalAgentSessionDigest(record.workspace) !==
      canonicalAgentSessionDigest(stored.workspace) ||
    localTaskBindingKey(stored.binding.paperclipCompanyId, stored.binding.command.task.runId) !==
      options.key ||
    stored.fingerprint !== intent.fingerprint ||
    digest(intent.input) !== intent.fingerprint ||
    intent.input.paperclipCompanyId !== stored.binding.paperclipCompanyId ||
    stored.binding.command.task.spaceId !== stored.binding.paperclipCompanyId ||
    intent.input.paperclipAgentId !== stored.binding.paperclipAgentId ||
    canonicalAgentSessionDigest(intent.input.task) !==
      canonicalAgentSessionDigest(stored.binding.command.task) ||
    stored.binding.command.inputRef !== `input:${digest(intent.input.input)}` ||
    intent.input.executionDeadlineAt !== stored.binding.command.executionDeadlineAt ||
    canonicalAgentSessionDigest(intent.input.workflowContext ?? {}) !==
      canonicalAgentSessionDigest(stored.binding.command.workflowContext ?? {}) ||
    stored.binding.command.ownerScope.kind !== 'personalTenant' ||
    stored.binding.command.ownerScope.tenantRef !== accountRef ||
    stored.binding.command.executionAccountRef !== accountRef ||
    stored.binding.command.profileId !== 'codex' ||
    stored.binding.command.profileRevision !== 'codex:1' ||
    (intent.input.executionMode === 'enforced_autonomous'
      ? !isTaskDockerEnforcementPolicy(stored.binding.command.executionPolicy) ||
        stored.binding.command.policyRevision !== 'docker-local-linux:1'
      : stored.binding.command.executionPolicy.trustMode !== 'trusted_personal_preview' ||
        stored.binding.command.executionPolicy.executionPolicyRef !== 'personal-preview' ||
        stored.binding.command.executionPolicy.executionPolicyRevision !== '1' ||
        stored.binding.command.policyRevision !== 'personal-preview:1') ||
    stored.workspace.isolation !== 'managed_copy' ||
    !suffix ||
    isAbsolute(suffix) ||
    suffix === '..' ||
    suffix.startsWith(`..${sep}`)
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const assertCurrent = () => {
    assertDirectory()
    bindingFile.assertCurrent()
    intentFile.assertCurrent()
    assertTaskDirectoryIdentity(stored.workspace.executionPath, stored.workspace.directoryIdentity)
    if (stored.binding.command.workflowContext?.role === 'tester') {
      assertTaskOutputWorkspace(stored.workspace)
    }
  }
  assertCurrent()
  return { ...stored, key: options.key, input: intent.input, assertCurrent }
}
