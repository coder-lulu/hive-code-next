import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { vi } from 'vitest'
import { planRunFixture } from './hive-workflow-plan-run.test-fixture'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { createLocalTaskFacadeAssembly } from './local-task-facade-assembly'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { TaskArtifactIndex } from './task-artifact-index'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { startLocalTaskTransport } from './local-task-transport'
import { LocalTaskClient } from './local-task-client'
import { TaskExecutionError } from './task-execution-error'
import {
  startWorkflowPrepareUnitService,
  workflowPrepareBindingCommit
} from './local-task-workflow-prepare-service.test-fixture'

/** Actual HTTP, issuer and managed-copy files; account/Docker/service rows are explicit unit fixtures. */
export async function planPrepareFixture(
  parent = resolve('logs/paperclip-development/20261011-plan-graph/main/tmp')
) {
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'prepare-')),
    source = join(root, 'source'),
    directory = join(root, 'tasks')
  await mkdir(source)
  await mkdir(directory)
  await writeFile(join(source, 'app.ts'), 'export const unit = true\n')
  const graphData = planRunFixture()
  const f = { team: graphData.source.team, view: graphData.original }
  const stage = graphData.view.tasks[0]
  const workspaceRef = `workspace:${createHash('sha256')
    .update(JSON.stringify(await realpath(source)))
    .digest('hex')}`
  f.view.team.project.hiveWorkspaceRef = f.team.project.binding.hiveWorkspaceRef = workspaceRef
  const { admission, refs, task } = graphData
  admission.workspaceSelector = f.team.project.workspaceSelector
  task.run_scope.workspaceRef = workspaceRef
  let account: HiveRuntimeCloudAuthorization | null = {
    accountId: 'workflow-case-owner',
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
  const { bindingWrite, bindingCommit } = workflowPrepareBindingCommit(task, stage)
  const beforeTaskRead = vi.fn(async () => undefined)
  const service = await startWorkflowPrepareUnitService({
    directory,
    accountId: () => account?.accountId,
    team: f.team,
    view: f.view,
    admission,
    graph: graphData.view,
    cancelTask: () => {
      task.cancel_requested = true
      admission.run.status = 'cancelRequested'
      graphData.view.runs[0].status = 'cancelRequested'
      return task
    },
    task,
    runId: refs.runId,
    bindingCommit,
    beforeTaskRead,
    requests
  })
  const assembly = createLocalTaskFacadeAssembly({
    directory,
    artifacts: new TaskArtifactIndex(join(directory, 'artifacts')),
    codeInspection: null,
    sessionInspection: null,
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
    preparePlanRun: assembly.preparePlanRun,
    resolveBinding: (company, run, purpose, actor) =>
      issuer.resolveBinding(company, run, actor.operationCallerKey, purpose)
  })
  const client = new LocalTaskClient({ baseUrl: transport.baseUrl, secret: credential.secret })
  return {
    ...f,
    graph: graphData.view,
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
    bindingWrite,
    beforeTaskRead,
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
