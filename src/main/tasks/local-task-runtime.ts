import { join } from 'node:path'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { lstatSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { HiveAccountService } from '../hive-account/hive-account-service'
import type { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud/hive-runtime-cloud-presence-service'
import type { LocalRuntimeOwnershipService } from '../hive-runtime-cloud/local-runtime-ownership-service'
import { resolveHiveAgentLocalProject } from '../native-chat/hive-agent-local-project'
import { getStructuredAgentSessionResources } from '../runtime/structured-agent-session-runtime'
import { RUNTIME_CAPABILITIES } from '../../shared/protocol-version'
import {
  TASK_EXECUTION_CAPABILITY,
  TASK_STOP_PROOF_CAPABILITY,
  TASK_WORKSPACE_CLAIM_CAPABILITY
} from '../../shared/task-execution/task-execution-primitives'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { TaskExecutionHost } from './task-execution-host'
import { createLocalTaskAuthorizer } from './local-task-authority'
import { createTaskDeliveryAuthorizer } from './task-delivery-authority'
import { createHiveTaskServiceContext } from './hive-task-service-context'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { startLocalTaskTransport } from './local-task-transport'
import { createTaskAgentLaunchPort } from './task-agent-launch-port'
import { createTaskCodexEvidence } from './task-codex-evidence'
import { refuseTaskExecution } from './task-execution-error'
import { createHiveTaskFacade } from './hive-task-facade'
import { TaskArtifactIndex } from './task-artifact-index'
import { installTaskAuthorizationMonitor } from './task-authorization-monitor'
import { taskLaunchPathKey } from './task-launch-workspace'
import { assertTaskDirectoryIdentity } from './task-managed-copy'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'

/** One task service assembled from the existing account, Runtime, record store and Codex host. */
export async function startLocalTaskRuntime(options: {
  userDataPath: string
  runtime: OrcaRuntimeService
  store: Store
  account: Pick<
    HiveAccountService,
    'getRuntimeCloudAuthorization' | 'subscribeRuntimeCloudAuthorization'
  >
  ownership: Pick<LocalRuntimeOwnershipService, 'getState' | 'subscribe'>
  presence: Pick<
    HiveRuntimeCloudPresenceService,
    'getCurrentLeaseContext' | 'subscribeLeaseContext'
  >
}) {
  const directory = join(options.userDataPath, 'hive-tasks')
  const descriptorPath = join(directory, 'transport.json')
  let closed = false
  await options.runtime.ensureStructuredAgentSessionHost()
  const resources = await getStructuredAgentSessionResources()
  const assertCurrent = () => {
    if (closed) {
      return refuseTaskExecution('SERVICE_UNAVAILABLE')
    }
    assertTaskAuthorizationCurrent(() => resources.assertCurrent())
  }
  const currentRuntime = () => {
    const account = options.account.getRuntimeCloudAuthorization()
    const owner = options.ownership.getState()
    const lease = options.presence.getCurrentLeaseContext()
    if (
      closed ||
      !account ||
      !lease ||
      account.sessionExpiresAt <= Date.now() ||
      owner.relation !== 'CLAIMED_BY_CURRENT' ||
      owner.accountId !== account.accountId ||
      owner.sessionGeneration !== account.sessionGeneration ||
      owner.runtimeRecordId !== lease.tuple.runtimeRecordId ||
      lease.authorityId !== account.authorityId ||
      ['FENCED', 'STOPPED', 'DISABLED'].includes(owner.presence)
    ) {
      return null
    }
    return {
      runtimeRecordId: lease.tuple.runtimeRecordId,
      ownershipEpoch: lease.tuple.fencingEpoch,
      accountId: account.accountId
    }
  }
  const resolveWorkspaceSource = async (selector: string) => {
    const proof = await resolveHiveAgentLocalProject(options.runtime, options.store, selector)
    const scope = await options.runtime.showTerminalWorkspaceLaunchScope(selector)
    if (scope.connectionId !== null) {
      return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    assertTaskAuthorizationCurrent(() => proof.assertCurrent())
    return { path: scope.path, assertCurrent: proof.assertCurrent }
  }
  const issuer = new LocalTaskBindingIssuer({
    directory,
    operationCallerKey: 'trusted-local:runtime',
    currentRuntime,
    currentAccount: () => options.account.getRuntimeCloudAuthorization(),
    assertCurrent,
    resolveSource: resolveWorkspaceSource,
    readExecution: (command) => resources.store.tasks.get(command),
    restoreWorkspace: async (workspace) => {
      if (!workspace.workspaceId.startsWith('folder:')) {
        return refuseTaskExecution('FORBIDDEN')
      }
      const id = workspace.workspaceId.slice('folder:'.length)
      const expected = realpathSync(workspace.executionPath)
      const guard = () => {
        assertCurrent()
        assertTaskDirectoryIdentity(workspace.executionPath, workspace.directoryIdentity)
        const current = options.store.getFolderWorkspace(id)
        if (
          !current ||
          current.isArchived ||
          current.connectionId ||
          lstatSync(workspace.executionPath).isSymbolicLink() ||
          taskLaunchPathKey(realpathSync(current.folderPath)) !== taskLaunchPathKey(expected) ||
          taskLaunchPathKey(expected) !== taskLaunchPathKey(workspace.executionPath)
        ) {
          return refuseTaskExecution('FORBIDDEN')
        }
      }
      guard()
      return { assertCurrent: guard }
    },
    registerWorkspace: async (path) => {
      assertCurrent()
      const workspace = await options.store.runDurableMutation(() => {
        const group =
          options.store
            .getProjectGroups()
            .find((entry) => entry.parentPath === directory && !entry.connectionId) ??
          options.store.createProjectGroup({
            name: '任务执行',
            parentPath: directory,
            connectionId: null,
            createdFrom: 'manual'
          })
        return {
          value: options.store.createFolderWorkspace({
            projectGroupId: group.id,
            name: 'Codex task',
            folderPath: path,
            connectionId: null,
            creatorProvenance: { kind: 'host' },
            createdWithAgent: 'codex'
          })
        }
      })
      const expectedPath = realpathSync(path)
      return {
        workspaceId: folderWorkspaceKey(workspace.id),
        assertCurrent: () => {
          assertCurrent()
          const current = options.store.getFolderWorkspace(workspace.id)
          if (
            !current ||
            current.isArchived ||
            current.connectionId ||
            realpathSync(current.folderPath) !== expectedPath
          ) {
            return refuseTaskExecution('FORBIDDEN')
          }
        }
      }
    }
  })
  const capabilities = () => {
    assertCurrent()
    const owner = currentRuntime()
    if (!owner) {
      return refuseTaskExecution('FORBIDDEN')
    }
    return {
      protocolVersion: 1,
      kind: 'execution.capabilities',
      runtimeRecordId: owner.runtimeRecordId,
      ownershipEpoch: owner.ownershipEpoch,
      host: 'native',
      capabilities: [
        ...RUNTIME_CAPABILITIES,
        TASK_EXECUTION_CAPABILITY,
        TASK_STOP_PROOF_CAPABILITY,
        TASK_WORKSPACE_CLAIM_CAPABILITY
      ],
      resourceCoverage: [],
      manifestVersions: [],
      resolverVersions: []
    }
  }
  const evidence = createTaskCodexEvidence(join(directory, 'artifacts'))
  const host = new TaskExecutionHost({
    store: resources.store.tasks,
    capabilities,
    resolveStart: (query) => issuer.resolveGrant(query.authorizationRef)?.command ?? null,
    authorize: createTaskDeliveryAuthorizer({
      authorize: createLocalTaskAuthorizer({
        currentRuntime,
        currentAccount: () => options.account.getRuntimeCloudAuthorization(),
        resolveGrant: issuer.resolveGrant
      }),
      context: createHiveTaskServiceContext({
        descriptorPath: join(directory, 'paperclip.json'),
        currentAccount: () => options.account.getRuntimeCloudAuthorization(),
        assertCurrent
      })
    }),
    launch: createTaskAgentLaunchPort({
      executor: 'codex',
      context: () => ({ runtime: options.runtime }),
      capabilities: () => RUNTIME_CAPABILITIES
    }),
    ...evidence
  })
  const credential = createLocalTaskServiceCredential('trusted-local:runtime')
  await issuer.restoreBindings(await resources.store.tasks.readActive(assertCurrent))
  const transport = await startLocalTaskTransport({
    host,
    capabilities,
    currentOwner: currentRuntime,
    authenticate: credential.authenticate,
    resolveBinding: (companyId, runId, purpose, caller) =>
      issuer.resolveBinding(companyId, runId, caller.operationCallerKey, purpose)
  })
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    assertCurrent()
    await writeFile(
      descriptorPath,
      JSON.stringify({ baseUrl: transport.baseUrl, secret: credential.secret }),
      { mode: 0o600 }
    )
  } catch (error) {
    closed = true
    await transport.close()
    await issuer.close()
    throw error
  }
  const monitor = installTaskAuthorizationMonitor({
    issuer,
    store: resources.store.tasks,
    host,
    assertCurrent,
    operationCallerKey: 'trusted-local:runtime',
    subscribe(listener) {
      const account = options.account.subscribeRuntimeCloudAuthorization(listener)
      const ownership = options.ownership.subscribe(listener)
      const lease = options.presence.subscribeLeaseContext(listener)
      return () => {
        account()
        ownership()
        lease()
      }
    }
  })
  let closing: Promise<void> | undefined
  return {
    descriptorPath,
    issuer,
    host,
    facade: createHiveTaskFacade({
      descriptorPath: join(directory, 'paperclip.json'),
      artifacts: new TaskArtifactIndex(join(directory, 'artifacts')),
      issuer,
      currentAccount: () => options.account.getRuntimeCloudAuthorization(),
      assertCurrent,
      validateWorkspace: async (selector) => {
        const source = await resolveWorkspaceSource(selector)
        return {
          workspaceRef: `workspace:${createHash('sha256').update(JSON.stringify(source.path)).digest('hex')}`,
          assertCurrent: source.assertCurrent
        }
      }
    }),
    close() {
      closed = true
      closing ??= (async () => {
        await monitor.close()
        await transport.close()
        await issuer.close()
        await host.drain()
        await unlink(descriptorPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') {
            throw error
          }
        })
      })()
      return closing
    }
  }
}
