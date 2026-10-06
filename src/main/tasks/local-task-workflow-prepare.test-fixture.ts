import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { vi } from 'vitest'
import { workflowCaseFixture } from '../../shared/hive-workflow-cases.test-fixture'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { hiveWorkflowStageContext } from '../../shared/hive-workflow-stage-context'
import { hiveWorkflowStagePrompt } from '../../shared/hive-workflow-stage-prompt'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { createLocalTaskFacadeAssembly } from './local-task-facade-assembly'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { TaskArtifactIndex } from './task-artifact-index'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { startLocalTaskTransport } from './local-task-transport'
import { LocalTaskClient } from './local-task-client'
import { TaskExecutionError } from './task-execution-error'
import { HiveRuntimeAdapterBinding, type HiveRuntimeBinding } from './paperclip-adapter-contract'
import { startWorkflowPrepareUnitService } from './local-task-workflow-prepare-service.test-fixture'

/** Actual HTTP, issuer and managed-copy files; account/Docker/service rows are explicit unit fixtures. */
export async function workflowPrepareFixture() {
  const parent = resolve('logs/paperclip-development/p3/case-consumption/native-prepare/tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'prepare-')),
    source = join(root, 'source'),
    directory = join(root, 'tasks')
  await mkdir(source)
  await mkdir(directory)
  await writeFile(join(source, 'app.ts'), 'export const unit = true\n')
  const f = workflowCaseFixture('prepare-unit-owner'),
    stage = f.view.stageTasks[0]
  const workspaceRef = `workspace:${createHash('sha256')
    .update(JSON.stringify(await realpath(source)))
    .digest('hex')}`
  f.view.team.project.hiveWorkspaceRef = f.team.project.binding.hiveWorkspaceRef = workspaceRef
  stage.status = 'todo'
  stage.taskRevision = 1
  const startRequest = {
    requestId: randomUUID(),
    projectId: f.input.projectId,
    caseId: f.view.id,
    expectedCaseRevision: f.view.revision,
    stageRef: stage.stageRef,
    expectedTaskRevision: 0
  }
  const taskRef = {
    spaceId: f.view.binding.scope.companyRef,
    taskId: stage.taskId,
    runId: randomUUID(),
    attempt: 1,
    taskRevision: '1'
  }
  const input = hiveWorkflowStagePrompt(f.view, stage.stageRef)
  const admission = {
    requestId: startRequest.requestId,
    payloadFingerprint: digest({ operation: 'cases.start', input: startRequest }),
    replayed: true,
    run: {
      caseId: f.view.id,
      stageRef: stage.stageRef,
      role: stage.role,
      employeeRef: stage.employeeRef,
      startRequest,
      task: taskRef,
      title: 'Unit prepared role',
      status: 'pending',
      artifactRefs: []
    },
    definitionDigest: f.view.definitionDigest,
    projectBindingRevision: f.view.projectBindingRevision,
    input,
    inputDigest: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    workspaceSelector: f.team.project.workspaceSelector,
    executionDeadlineAt: new Date(Date.now() + 120_000).toISOString(),
    workflowContext: hiveWorkflowStageContext(f.view, stage.stageRef)
  }
  const refs = {
    projectId: f.input.projectId,
    caseId: f.view.id,
    taskId: taskRef.taskId,
    runId: taskRef.runId
  }
  const task = {
    id: refs.taskId,
    run_id: refs.runId,
    company_id: taskRef.spaceId,
    agent_id: stage.employeeRef,
    title: 'Unit prepared role',
    status: 'todo',
    status_version: 1,
    binding: HiveRuntimeAdapterBinding.nullable().parse(null),
    result_receipt: null,
    cancel_requested: false,
    driver_kind: 'hive_runtime',
    run_status: 'queued',
    checkout_run_id: null,
    execution_locked_at: null,
    execution_run_id: refs.runId,
    execution_stage: null,
    run_scope: {
      kind: 'workbenchCase',
      projectId: refs.projectId,
      caseId: refs.caseId,
      workspaceRef
    }
  }
  let account: HiveRuntimeCloudAuthorization | null = {
    accountId: 'prepare-unit-owner',
    authorityId: 'unit-authority',
    sessionGeneration: 1,
    sessionExpiresAt: Date.now() + 300_000,
    accessToken: 'unit-only'
  }
  let owner = {
    accountId: account.accountId,
    runtimeRecordId: 'runtime:prepare-unit',
    ownershipEpoch: 1
  }
  let active = true,
    workspaceCurrent = true,
    enforcementCurrent = true,
    callerCurrent = true
  const guard = () => {
    if (!active) {
      throw new TaskExecutionError('SERVICE_UNAVAILABLE')
    }
  }
  const workspaceGuard = () => {
    guard()
    if (!workspaceCurrent) {
      throw new TaskExecutionError('FORBIDDEN')
    }
  }
  const enforcementGuard = () => {
    guard()
    if (!enforcementCurrent) {
      throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
    }
  }
  const enforcement = {
    owner: {
      runtimeRecordId: owner.runtimeRecordId,
      ownershipEpoch: owner.ownershipEpoch,
      executionAccountRef: f.view.team.company.ownerAccountRef
    },
    policy: {
      trustMode: 'enforced_autonomous' as const,
      executionPolicyRef: 'docker-local-linux',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: `docker-enforcement:${'a'.repeat(64)}`
    },
    daemon: {
      ID: 'unit-daemon',
      OSType: 'linux' as const,
      Architecture: 'amd64' as const,
      ServerVersion: 'unit'
    },
    assertCurrent: enforcementGuard
  }
  const issuerOptions = {
    directory,
    operationCallerKey: 'trusted-local:runtime',
    currentAccount: () => account,
    currentRuntime: () => owner,
    assertCurrent: guard,
    resolveSource: async (selector: string) => {
      if (selector !== admission.workspaceSelector) {
        throw new TaskExecutionError('FORBIDDEN')
      }
      return { path: await realpath(source), assertCurrent: workspaceGuard }
    },
    registerWorkspace: async () => ({
      workspaceId: 'folder:unit-prepare',
      assertCurrent: workspaceGuard
    }),
    readExecution: () => null,
    restoreWorkspace: async () => ({ assertCurrent: workspaceGuard }),
    resolveEnforcement: async () => enforcement
  }
  const issuer = new LocalTaskBindingIssuer(issuerOptions),
    issue = vi.spyOn(issuer, 'issue')
  const requests: { path: string; body: unknown }[] = []
  const bindingCommit = vi.fn(async (body: HiveRuntimeBinding) => {
    task.binding = body
    task.status = 'in_progress'
    task.status_version += 1
    stage.taskRevision += 1
    stage.status = 'in_progress'
    return task
  })
  const service = await startWorkflowPrepareUnitService({
    directory,
    accountId: () => account?.accountId,
    team: f.team,
    view: f.view,
    admission,
    task,
    runId: refs.runId,
    bindingCommit,
    requests
  })
  const assembly = createLocalTaskFacadeAssembly({
    directory,
    artifacts: new TaskArtifactIndex(join(directory, 'artifacts')),
    issuer,
    currentAccount: () => account,
    currentRuntime: () => owner,
    assertCurrent: guard,
    enforcement: async () => enforcement,
    resolveWorkspaceSource: issuerOptions.resolveSource
  })
  const credential = createLocalTaskServiceCredential('trusted-local:runtime')
  const unavailable = vi.fn(async () => {
    throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
  })
  const caller = {
    operationCallerKey: 'trusted-local:runtime',
    assertCurrent: () => {
      if (!callerCurrent) {
        throw new TaskExecutionError('FORBIDDEN')
      }
    }
  }
  const transport = await startLocalTaskTransport({
    host: {
      start: unavailable,
      observe: unavailable,
      cancel: unavailable,
      reconcile: unavailable,
      workflowOutcome: unavailable,
      workflowCommands: unavailable,
      workflowArtifact: unavailable
    },
    authenticate: (bearer) => (credential.authenticate(bearer) ? caller : null),
    capabilities: () => ({}),
    currentOwner: () => owner,
    prepareCaseRun: assembly.prepareCaseRun,
    resolveBinding: (company, run, purpose, actor) =>
      issuer.resolveBinding(company, run, actor.operationCallerKey, purpose)
  })
  const client = new LocalTaskClient({ baseUrl: transport.baseUrl, secret: credential.secret })
  return {
    ...f,
    root,
    source,
    directory,
    admission,
    refs,
    task,
    owner,
    issuer,
    issuerOptions,
    issue,
    assembly,
    bindingCommit,
    requests,
    client,
    caller,
    transport,
    credential,
    unavailable,
    revokeCaller: () => {
      callerCurrent = false
    },
    revokeWorkspace: () => {
      workspaceCurrent = false
    },
    revokeEnforcement: () => {
      enforcementCurrent = false
    },
    closeRuntime: () => {
      active = false
    },
    switchAccount: () => {
      account = { ...account!, accountId: 'foreign-unit-owner' }
    },
    revokeSession: () => {
      account = { ...account!, sessionGeneration: 2 }
    },
    signOut: () => {
      account = null
    },
    revokeOwner: () => {
      owner = { ...owner, ownershipEpoch: owner.ownershipEpoch + 1 }
    },
    async close() {
      await transport.close()
      await issuer.close()
      await service.close()
    }
  }
}
