import { join } from 'node:path'
import type { getStructuredAgentSessionResources } from '../runtime/structured-agent-session-runtime'
import type { VerifiedManagedPiPack } from '../runtime/managed-pi-runtime-identity'
import type { AiAuthorizationSource } from '../hive-runtime-cloud/hive-ai-cloud-operation'
import type { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud/hive-runtime-cloud-presence-service'
import { HiveAiTextGrantClient } from '../hive-runtime-cloud/hive-ai-text-grant-client'
import { HiveAiTextStreamClient } from '../hive-runtime-cloud/hive-ai-text-stream-client'
import type {
  HiveAgentHostDependencies,
  HiveAgentPrincipalResolver
} from './hive-agent-session-dependencies'
import { createManagedPiCloudAuthorityResolver } from './managed-pi-cloud-authority'
import { createManagedPiCloudInference } from './managed-pi-cloud-inference'
import { createManagedPiExecutionHost } from './managed-pi-execution-host'
import { HiveAgentSessionHost } from './hive-agent-session-host'
import { AgentSessionJournal } from './agent-session-journal/journal-store'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import { managedPiExecutionRecordId } from '../runtime/managed-pi-execution-lease'
import { createHiveAgentCloudControl } from './hive-agent-cloud-control'
import { HiveAiTextControlClient } from '../hive-runtime-cloud/hive-ai-text-control-client'

type Resources = Awaited<ReturnType<typeof getStructuredAgentSessionResources>>
type ExecutionOptions = Parameters<typeof createManagedPiExecutionHost>[0]
type Options = {
  resources: Resources
  pack: VerifiedManagedPiPack | null
  origin: string
  runtimeRecordId: string
  account: Pick<AiAuthorizationSource, 'getRuntimeCloudAuthorization'>
  presence: Pick<HiveRuntimeCloudPresenceService, 'getCurrentLeaseContext'>
  scopeFor: ExecutionOptions['scopeFor']
  assertAuthorized: ExecutionOptions['assertAuthorized']
  principalForSession: (sessionId: string) => ReturnType<HiveAgentPrincipalResolver>
  eligibilityRevision: () => number
  assertOrigin: () => void
  resolveModel: NonNullable<HiveAgentHostDependencies['resolveModel']>
  now?: () => number
}

/** One owner for product sessions, Pi processes and journals; caller retains it through failed close. */
export class HiveAgentCloudHost {
  private starting?: Promise<HiveAgentSessionHost>
  private host?: HiveAgentSessionHost
  private execution?: Awaited<ReturnType<typeof createManagedPiExecutionHost>>
  private readonly journals = new Map<
    string,
    { identity: string; journal: AgentSessionJournal; opening: Promise<AgentSessionJournal> }
  >()
  private closed = false
  private readonly lifetime = new AbortController()
  private closing?: Promise<void>
  constructor(private readonly options: Options) {}

  open(): Promise<HiveAgentSessionHost> {
    if (this.closed) {
      return Promise.reject(new Error('hive_agent_capability_unavailable'))
    }
    this.starting ??= this.install().catch(async () => {
      this.closed = true
      await this.dispose()
      throw new Error('hive_agent_capability_unavailable')
    })
    return this.starting
  }

  private assertCurrent = () => {
    if (this.closed) {
      throw new Error('hive_agent_capability_unavailable')
    }
    this.options.resources.assertCurrent()
    this.options.assertOrigin()
  }

  private journalFor = async (entry: HiveAgentSessionEntry): Promise<AgentSessionJournal> => {
    this.assertCurrent()
    if (entry.aggregate.binding?.providerKind !== 'managed-pi') {
      throw new Error('hive_agent_forbidden')
    }
    const sessionId = entry.aggregate.session.sessionId
    const identity = JSON.stringify([entry.accountId, entry.deviceId, entry.projectScope])
    let found = this.journals.get(sessionId)
    if (found && found.identity !== identity) {
      throw new Error('hive_agent_forbidden')
    }
    if (!found) {
      const journalIdentity = {
        sessionId,
        workspaceId: entry.projectScope,
        hostId: 'local',
        agent: 'pi',
        providerHandle: { transport: 'managed-pi', agent: 'pi', nativeId: sessionId }
      }
      const journal = new AgentSessionJournal({
        identity: journalIdentity,
        database: this.options.resources.journalDatabase
      })
      // Retain even a partially opened journal until close proves its handle released.
      const opening = journal.open().then(() => journal)
      found = { identity, journal, opening }
      this.journals.set(sessionId, found)
    }
    const journal = await found.opening
    this.assertCurrent()
    return journal
  }

  private async install() {
    const options = this.options
    this.assertCurrent()
    const control = createHiveAgentCloudControl({
      sources: {
        ...options,
        assertOrigin: this.assertCurrent,
        readSession: (id) => options.resources.store.hive.get(id)
      },
      client: new HiveAiTextControlClient(options.origin),
      signal: this.lifetime.signal
    })
    const queryExecution = (entry: HiveAgentSessionEntry) => control(entry, 'status')
    if (options.resources.store.hostId !== 'local') {
      throw new Error('hive_agent_forbidden')
    }
    if (!options.pack) {
      this.host = await HiveAgentSessionHost.open({
        store: options.resources.store,
        runtimeRecordId: options.runtimeRecordId,
        executionUnavailable: 'hive_agent_pack_unavailable',
        queryExecution,
        journalFor: this.journalFor,
        fenceFor: (entry) =>
          options.resources.store.getRecord(
            managedPiExecutionRecordId(entry.aggregate.session.sessionId)
          )?.lease.runtimeFence ?? 1,
        now: options.now ?? Date.now,
        eligibilityRevision: options.eligibilityRevision,
        enabled: () => false
      })
      this.assertCurrent()
      return this.host
    }
    const resolve = createManagedPiCloudAuthorityResolver({
      ...options,
      assertOrigin: this.assertCurrent,
      readSession: (sessionId) => options.resources.store.hive.get(sessionId)
    })
    const inference = createManagedPiCloudInference({
      resolve,
      grants: new HiveAiTextGrantClient(options.origin),
      streams: new HiveAiTextStreamClient(options.origin)
    })
    this.execution = await createManagedPiExecutionHost({
      store: options.resources.store,
      pack: options.pack,
      runtimeRecordId: options.runtimeRecordId,
      homeRoot: join(options.resources.stateDirectory, 'managed-pi-homes'),
      claimKeyId: options.resources.claimKeyId,
      scopeFor: options.scopeFor,
      assertAuthorized: (scope) => {
        this.assertCurrent()
        options.assertAuthorized(scope)
      },
      inference,
      now: options.now ?? Date.now
    })
    this.assertCurrent()
    this.host = await HiveAgentSessionHost.open({
      store: options.resources.store,
      runtimeRecordId: options.runtimeRecordId,
      adapter: this.execution.adapter,
      queryExecution,
      readPack: this.execution.readPack,
      cancelExecution: (entry) => control(entry, 'cancel'),
      resolveModel: async (command, principal) => {
        this.assertCurrent()
        const result = await options.resolveModel(command, principal)
        this.assertCurrent()
        return {
          selection: result.selection,
          assertCurrent: () => {
            this.assertCurrent()
            result.assertCurrent()
          }
        }
      },
      journalFor: this.journalFor,
      fenceFor: this.execution.fenceFor,
      now: options.now ?? Date.now,
      eligibilityRevision: options.eligibilityRevision,
      enabled: () => {
        try {
          this.assertCurrent()
          return true
        } catch {
          return false
        }
      },
      releaseExecution: this.execution.release,
      closeExecution: this.execution.close
    })
    this.assertCurrent()
    return this.host
  }

  private async dispose() {
    // A child must be proven stopped before its journal can be closed.
    await (this.host ? this.host.close() : this.execution?.close())
    const results = await Promise.allSettled(
      [...this.journals].map(async ([id, entry]) => {
        await entry.opening.catch(() => undefined)
        await entry.journal.close()
        this.journals.delete(id)
      })
    )
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('hive_agent_outcome_unknown')
    }
  }

  close(): Promise<void> {
    this.closed = true
    this.lifetime.abort()
    this.closing ??= (async () => {
      await this.starting?.catch(() => undefined)
      await this.dispose()
    })().catch((error) => {
      this.closing = undefined
      throw error
    })
    return this.closing
  }
}
