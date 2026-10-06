import { randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TaskExecutionStartSchema } from '../../shared/task-execution/task-execution-command'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { LocalTaskGrant } from './local-task-authority'
import { HiveRuntimeAdapterBinding } from './paperclip-adapter-contract'
import { assertTaskDirectoryIdentity, createTaskManagedCopy } from './task-managed-copy'
import { refuseTaskExecution } from './task-execution-error'
import { taskCodexResultInstructions } from './task-codex-evidence'
import type { TaskExecutionWorkspace } from './task-execution-record'
import type { LocalTaskBindingInput } from './local-task-binding-file'
import type { LocalTaskBindingIssuer, LocalTaskRuntimeOwner } from './local-task-binding-issuer'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { TASK_ENFORCEMENT_CAPABILITY } from '../../shared/task-execution/task-execution-primitives'
import {
  assertTaskDockerEnforcementCommand,
  TASK_DOCKER_ENFORCEMENT_POLICY,
  TASK_DOCKER_ENFORCEMENT_REVISION
} from './task-docker-enforcement'
import { prepareTaskOutputWorkspace, assertTaskOutputWorkspace } from './task-output-workspace'

type BindingPreparationOptions = ConstructorParameters<typeof LocalTaskBindingIssuer>[0] & {
  requireOwner(): { account: HiveRuntimeCloudAuthorization; runtime: LocalTaskRuntimeOwner }
  now(): number
}
const reference = (kind: string) => `${kind}:${randomUUID()}`
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function prepareLocalTaskBinding(
  options: BindingPreparationOptions,
  input: LocalTaskBindingInput,
  key: string,
  fingerprint: string
) {
  const owner = options.requireOwner()
  const assertOwner = () => {
    const current = options.requireOwner()
    if (
      current.account.accountId !== owner.account.accountId ||
      current.account.authorityId !== owner.account.authorityId ||
      current.account.sessionGeneration !== owner.account.sessionGeneration ||
      current.runtime.runtimeRecordId !== owner.runtime.runtimeRecordId ||
      current.runtime.ownershipEpoch !== owner.runtime.ownershipEpoch
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
  }
  const enforcement =
    input.executionMode === 'enforced_autonomous'
      ? await (options.resolveEnforcement?.() ?? refuseTaskExecution('CAPABILITY_UNAVAILABLE'))
      : null
  assertOwner()
  if (enforcement) {
    assertTaskAuthorizationCurrent(() => enforcement.assertCurrent())
  }
  await mkdir(join(options.directory, 'bindings'), { recursive: true, mode: 0o700 })
  assertOwner()
  // An unfinished/restarted preparation is never silently reminted as another execution.
  try {
    await writeFile(
      join(options.directory, 'bindings', `${key}.intent.json`),
      JSON.stringify({ fingerprint, input }),
      { flag: 'wx', mode: 0o600 }
    )
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    throw error
  }
  const source = await options.resolveSource(input.workspaceSelector)
  const assertSource = () => {
    assertOwner()
    assertTaskAuthorizationCurrent(() => source.assertCurrent())
  }
  const workspaceDirectory = join(options.directory, 'workspaces')
  const copy = input.workflowContext?.codeInput
    ? await (options.restoreCodeInput?.(input, workspaceDirectory, assertSource) ??
        refuseTaskExecution('CAPABILITY_UNAVAILABLE'))
    : await createTaskManagedCopy({
        source: source.path,
        directory: workspaceDirectory,
        assertCurrent: assertSource
      })
  const output =
    input.workflowContext?.role === 'tester'
      ? await prepareTaskOutputWorkspace({ workspace: copy, assertCurrent: assertSource })
      : null
  assertOwner()
  const registered = await options.registerWorkspace(copy.executionPath)
  const assertCurrent = () => {
    assertOwner()
    if (enforcement) {
      assertTaskAuthorizationCurrent(() => enforcement.assertCurrent())
    }
    assertTaskAuthorizationCurrent(() => source.assertCurrent())
    assertTaskAuthorizationCurrent(() => copy.assertCurrent())
    if (output) {
      assertTaskAuthorizationCurrent(() => output.assertCurrent())
    }
    assertTaskAuthorizationCurrent(() => registered.assertCurrent())
  }
  assertCurrent()
  const workspace: TaskExecutionWorkspace = {
    hostId: 'local',
    workspaceId: registered.workspaceId,
    canonicalPath: copy.canonicalPath,
    executionPath: copy.executionPath,
    isolation: 'managed_copy',
    directoryIdentity: copy.directoryIdentity,
    ...(output ? { outputDirectory: output.outputDirectory } : {})
  }
  const command = TaskExecutionStartSchema.parse({
    protocolVersion: 1,
    kind: 'execution.start',
    runtimeRecordId: owner.runtime.runtimeRecordId,
    ownershipEpoch: owner.runtime.ownershipEpoch,
    executionId: reference('execution'),
    executionEpoch: 1,
    task: input.task,
    operationId: `${options.now()}-${randomUUID().replaceAll('-', '')}`,
    idempotencyKey: reference('start'),
    agent: 'hivecode',
    profileId: 'codex',
    profileRevision: 'codex:1',
    policyRevision: enforcement
      ? `${TASK_DOCKER_ENFORCEMENT_POLICY}:${TASK_DOCKER_ENFORCEMENT_REVISION}`
      : 'personal-preview:1',
    ownerScope: {
      kind: 'personalTenant',
      tenantRef: `account:${digest(owner.account.accountId)}`
    },
    executionAccountRef: `account:${digest(owner.account.accountId)}`,
    billingSubjectRef: 'billing:external-codex',
    workspaceRef: `workspace:${digest(source.path)}`,
    workspaceExecutionClaimRef: reference('claim'),
    isolationPolicyRef: 'managed-copy:1',
    writeFence: 1,
    executionPolicy: enforcement?.policy ?? {
      trustMode: 'trusted_personal_preview',
      executionPolicyRef: 'personal-preview',
      executionPolicyRevision: '1'
    },
    inputRef: `input:${digest(input.input)}`,
    authorizationRef: reference('authorization'),
    authorizationRevision: '1',
    expiresAt: new Date(
      Math.min(owner.account.sessionExpiresAt, options.now() + 60_000)
    ).toISOString(),
    ...(input.executionDeadlineAt === undefined
      ? {}
      : { executionDeadlineAt: input.executionDeadlineAt }),
    ...(input.workflowContext ? { workflowContext: input.workflowContext } : {}),
    requiredCapabilities: enforcement ? [TASK_ENFORCEMENT_CAPABILITY] : []
  })
  if (enforcement) {
    assertTaskDockerEnforcementCommand(command, enforcement)
  }
  const commandFingerprint = computeTaskExecutionFingerprint(command, options.operationCallerKey)
  const binding = HiveRuntimeAdapterBinding.parse({
    bindingRef: reference('binding'),
    paperclipCompanyId: input.paperclipCompanyId,
    paperclipAgentId: input.paperclipAgentId,
    command,
    commandFingerprint
  })
  const grant: LocalTaskGrant = {
    command,
    operationCallerKey: options.operationCallerKey,
    accountId: owner.account.accountId,
    authorityId: owner.account.authorityId,
    sessionGeneration: owner.account.sessionGeneration,
    runtimeOwnershipEpoch: owner.runtime.ownershipEpoch,
    validUntil: Date.parse(command.expiresAt),
    actions: ['start', 'observe', 'reconcile', 'cancel'],
    workspace,
    input: input.input + taskCodexResultInstructions({ command, commandFingerprint }),
    assertCurrent
  }
  const recoveryProof = await options.restoreWorkspace(workspace)
  assertCurrent()
  await writeFile(
    join(options.directory, 'bindings', `${key}.json`),
    JSON.stringify({
      binding,
      workspace,
      accountId: grant.accountId,
      authorityId: grant.authorityId,
      sessionGeneration: grant.sessionGeneration,
      fingerprint
    }),
    { flag: 'wx', mode: 0o600 }
  )
  assertCurrent()
  const entry = {
    binding,
    grant,
    fingerprint,
    assertExecutionCurrent: assertCurrent,
    assertWorkspaceCurrent: () => {
      assertTaskAuthorizationCurrent(() => options.assertCurrent?.())
      assertTaskDirectoryIdentity(workspace.executionPath, workspace.directoryIdentity)
      if (command.workflowContext?.role === 'tester') {
        assertTaskOutputWorkspace(workspace)
      }
      assertTaskAuthorizationCurrent(() => recoveryProof.assertCurrent())
    },
    accountId: owner.account.accountId,
    input: grant.input,
    workspace
  }
  return entry
}
