import { join } from 'node:path'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
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
import { createLocalTaskAuthorizer, createLocalTaskRuntimeOwner } from './local-task-authority'
import { createTaskDeliveryAuthorizer } from './task-delivery-authority'
import { createHiveTaskServiceContext } from './hive-task-service-context'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { startLocalTaskTransport } from './local-task-transport'
import { createTaskAgentLaunchPort } from './task-agent-launch-port'
import { createTaskCodexEvidence } from './task-codex-evidence'
import { createTaskCancelledDispatchSettlement } from './task-cancelled-dispatch'
import { refuseTaskExecution } from './task-execution-error'
import { createLocalTaskFacadeAssembly } from './local-task-facade-assembly'
import { TaskArtifactIndex } from './task-artifact-index'
import { TaskWorkflowOutcomeStore } from './task-workflow-outcome-store'
import { installTaskAuthorizationMonitor } from './task-authorization-monitor'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { createLocalTaskDockerEnforcement } from './task-docker-enforcement-runtime'
import { TaskCodeSnapshotStore } from './task-code-snapshot'
import { createWorkflowTaskCodeRestorer } from './task-workflow-code-input'
import { restoreLocalTaskWorkspace } from './local-task-workspace-recovery'
import { createLocalTaskSessionInspection } from './local-task-session-inspection'

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
  const currentRuntime = createLocalTaskRuntimeOwner({ ...options, isClosed: () => closed })
  const resolveWorkspaceSource = async (selector: string) => {
    const proof = await resolveHiveAgentLocalProject(options.runtime, options.store, selector)
    const scope = await options.runtime.showTerminalWorkspaceLaunchScope(selector)
    if (scope.connectionId !== null) {
      return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    assertTaskAuthorizationCurrent(() => proof.assertCurrent())
    return { path: scope.path, assertCurrent: proof.assertCurrent }
  }
  const enforcement = createLocalTaskDockerEnforcement({
    ...options,
    currentRuntime,
    assertCurrent
  })
  const artifacts = new TaskArtifactIndex(join(directory, 'artifacts'))
  const snapshots = new TaskCodeSnapshotStore(join(directory, 'artifacts'))
  const issuer = new LocalTaskBindingIssuer({
    directory,
    operationCallerKey: 'trusted-local:runtime',
    currentRuntime,
    currentAccount: () => options.account.getRuntimeCloudAuthorization(),
    assertCurrent,
    resolveEnforcement: enforcement.probe,
    resolveSource: resolveWorkspaceSource,
    restoreCodeInput: createWorkflowTaskCodeRestorer({
      snapshots,
      currentRuntime,
      resolveSource: resolveWorkspaceSource,
      operationCallerKey: 'trusted-local:runtime',
      readExecution: (identity) => resources.store.tasks.get(identity)
    }),
    readExecution: (command) => resources.store.tasks.get(command),
    restoreWorkspace: async (workspace) =>
      restoreLocalTaskWorkspace(workspace, {
        assertCurrent,
        getFolderWorkspace: (id) => options.store.getFolderWorkspace(id)
      }),
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
        TASK_WORKSPACE_CLAIM_CAPABILITY,
        ...enforcement.capabilities()
      ],
      resourceCoverage: [],
      manifestVersions: [],
      resolverVersions: []
    }
  }
  const evidence = createTaskCodexEvidence(join(directory, 'artifacts'))
  const host = new TaskExecutionHost({
    evidenceTimeoutMs: 30_000,
    workflowOutcomes: new TaskWorkflowOutcomeStore({
      directory,
      artifacts,
      snapshots,
      collectCommands: evidence.collectCommands
    }),
    store: resources.store.tasks,
    settleCancelledDispatch: createTaskCancelledDispatchSettlement(resources.store),
    capabilities,
    authorizeEnforcement: enforcement.authorize,
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
  const facadeService = createLocalTaskFacadeAssembly({
    directory,
    artifacts,
    codeInspection: { snapshots, readExecution: (identity) => resources.store.tasks.get(identity) },
    sessionInspection: createLocalTaskSessionInspection({
      resources,
      store: options.store,
      currentRuntime,
      assertCurrent
    }),
    issuer,
    enforcement: enforcement.current,
    currentAccount: () => options.account.getRuntimeCloudAuthorization(),
    currentRuntime,
    assertCurrent,
    resolveWorkspaceSource
  })
  const transport = await startLocalTaskTransport({
    host,
    capabilities,
    currentOwner: currentRuntime,
    prepareCaseRun: facadeService.prepareCaseRun,
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
    assertCurrent: () => assertTaskAuthorizationCurrent(() => resources.assertCurrent()),
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
    facade: facadeService.facade,
    close() {
      closed = true
      return (closing ??= (async () => {
        await monitor.close()
        await transport.close()
        await issuer.close()
        await host.drain()
        await unlink(descriptorPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') {
            throw error
          }
        })
      })().catch((error) => {
        closing = undefined
        throw error
      }))
    }
  }
}
