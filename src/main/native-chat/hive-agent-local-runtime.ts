import type { HiveAccountService } from '../hive-account/hive-account-service'
import type { getHiveAccountConfig } from '../hive-account/hive-account-config'
import type { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud/hive-runtime-cloud-presence-service'
import type { HiveAgentLocalPrincipal } from './hive-agent-local-principal'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { HiveAgentCloudHost } from './hive-agent-cloud-host'
import type { HiveAgentSessionHost } from './hive-agent-session-host'

type BoundProject = Awaited<ReturnType<HiveAgentLocalPrincipal['bindProject']>>
const unavailable = () => new Error('hive_agent_capability_unavailable')

/** Main-process local transport owner. No selectors or credentials are accepted as authority. */
export class HiveAgentLocalRuntime {
  private readonly projects = new Map<string, BoundProject>()
  private installed?: {
    owner: HiveAgentCloudHost
    runtimeId: string
    origin: string
    host?: HiveAgentSessionHost
  }
  private queue: Promise<unknown> = Promise.resolve()
  private stopped = false
  constructor(
    private readonly options: {
      account: Pick<
        HiveAccountService,
        'getRuntimeCloudAuthorization' | 'resolveAiModelForGeneration'
      >
      presence: Pick<HiveRuntimeCloudPresenceService, 'getCurrentLeaseContext'>
      principal: Pick<HiveAgentLocalPrincipal, 'bindProject' | 'eligibilityRevision'>
      runtime: Pick<OrcaRuntimeService, 'ensureStructuredAgentSessionHost'>
      getConfig: typeof getHiveAccountConfig
      resourcesDirectory: string
    }
  ) {}

  openProject(selector: string) {
    const operation = this.queue.then(async () => {
      if (this.stopped) {
        throw unavailable()
      }
      const project = await this.options.principal.bindProject(selector)
      if (this.stopped || !project.resolvePrincipal()) {
        throw unavailable()
      }
      this.projects.set(project.projectScope, project)
      const host = await this.openHost()
      if (this.stopped || !project.resolvePrincipal()) {
        throw unavailable()
      }
      return Object.freeze({
        projectScope: project.projectScope,
        call: (method: string, params: unknown) => {
          // Legacy sessions are retained for reading and retirement only. All new execution uses Pi.
          if (method === 'hiveAgent.create' || method === 'hiveAgent.submit') {
            return Promise.reject(unavailable())
          }
          return host.call(method, params, project.resolvePrincipal)
        },
        subscribe: (params: unknown, emit: Parameters<HiveAgentSessionHost['subscribe']>[2]) =>
          host.subscribe(params, project.resolvePrincipal, emit)
      })
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  private async openHost() {
    const options = this.options
    const configured = options.getConfig()
    const lease = options.presence.getCurrentLeaseContext()
    if (this.stopped || !configured.configured || !lease) {
      throw unavailable()
    }
    const origin = configured.config.apiBaseUrl,
      runtimeId = lease.tuple.runtimeRecordId
    if (
      this.installed &&
      (this.installed.runtimeId !== runtimeId ||
        this.installed.origin !== origin ||
        !this.installed.host)
    ) {
      await this.installed.owner.close()
      this.installed = undefined
    }
    if (this.installed?.host) {
      return this.installed.host
    }
    await options.runtime.ensureStructuredAgentSessionHost()
    const [
      { getStructuredAgentSessionResources },
      { loadProductManagedPiTextPack },
      { HiveAgentCloudHost }
    ] = await Promise.all([
      import('../runtime/structured-agent-session-runtime'),
      import('../runtime/managed-pi-pack-product'),
      import('./hive-agent-cloud-host')
    ])
    const resources = await getStructuredAgentSessionResources()
    const pack = await loadProductManagedPiTextPack(options.resourcesDirectory).catch(
      (error: unknown) => {
        if (error instanceof Error && error.message === 'hive_agent_pack_unavailable') {
          return null
        }
        throw error
      }
    )
    const assertOrigin = () => {
      const current = options.getConfig()
      if (
        this.stopped ||
        !current.configured ||
        current.config.apiBaseUrl !== origin ||
        options.presence.getCurrentLeaseContext()?.tuple.runtimeRecordId !== runtimeId
      ) {
        throw unavailable()
      }
    }
    assertOrigin()
    const owner = new HiveAgentCloudHost({
      resources,
      pack,
      origin,
      runtimeRecordId: runtimeId,
      account: options.account,
      presence: options.presence,
      assertOrigin,
      eligibilityRevision: () => options.principal.eligibilityRevision(),
      principalForSession: (id) => {
        const entry = resources.store.hive.get(id)
        return entry ? (this.projects.get(entry.projectScope)?.resolvePrincipal() ?? null) : null
      },
      scopeFor: (entry) => {
        const project = this.projects.get(entry.projectScope)
        if (!project?.resolvePrincipal()) {
          throw unavailable()
        }
        return {
          sessionId: entry.aggregate.session.sessionId,
          accountId: entry.accountId,
          deviceId: entry.deviceId,
          projectScope: entry.projectScope,
          runtimeRecordId: runtimeId,
          workspaceKind: project.workspaceKind
        }
      },
      assertAuthorized: (scope) => {
        const project = this.projects.get(scope.projectScope)
        if (!project) {
          throw unavailable()
        }
        project.assertAuthorized(scope)
      },
      resolveModel: (command, principal) =>
        options.account.resolveAiModelForGeneration(command, principal.accountId)
    })
    this.installed = { owner, runtimeId, origin }
    try {
      const host = await owner.open()
      assertOrigin()
      this.installed.host = host
      return host
    } catch (error) {
      await owner.close()
      this.installed = undefined
      throw error
    }
  }

  async close() {
    this.stopped = true
    this.projects.clear()
    await this.queue
    if (this.installed) {
      await this.installed.owner.close()
      this.installed = undefined
    }
  }
}
