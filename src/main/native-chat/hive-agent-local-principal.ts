import {
  HIVE_AGENT_METHODS,
  type AuthenticatedRuntimePrincipal
} from '../../shared/hive-agent-session-methods'
import type { getHiveAccountConfig } from '../hive-account/hive-account-config'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { LocalRuntimeOwnershipService } from '../hive-runtime-cloud/local-runtime-ownership-service'
import { HiveRuntimeCloudAccountClient } from '../hive-runtime-cloud/hive-runtime-cloud-account-client'
import {
  HiveAiCloudOperation,
  type AiAuthorizationSource
} from '../hive-runtime-cloud/hive-ai-cloud-operation'
import { hiveAgentLocalIdentitySchema } from '../hive-runtime-cloud/hive-agent-local-identity'
import type { ManagedPiSessionScope } from '../runtime/managed-pi-execution-lease'

export type HiveAgentLocalProject = Readonly<{
  projectScope: string
  workspaceKind: 'folder' | 'git-worktree'
  assertCurrent: () => void
}>
const forbidden = () => new Error('hive_agent_forbidden')

/** Main-process producer; neither a bearer payload nor an RPC context supplies identity. */
export class HiveAgentLocalPrincipal {
  private revision = 1
  private stopped = false
  private readonly lifetime = new AbortController()
  private readonly unsubscribeAccount: () => void
  private readonly unsubscribeOwnership: () => void
  private readonly identity: HiveAiCloudOperation<{
    origin: string
    authorization: HiveRuntimeCloudAuthorization
    identity: ReturnType<typeof hiveAgentLocalIdentitySchema.parse>
  }>

  constructor(
    private readonly account: AiAuthorizationSource,
    private readonly ownership: Pick<LocalRuntimeOwnershipService, 'getState' | 'subscribe'>,
    private readonly getConfig: typeof getHiveAccountConfig,
    private readonly resolveProject: (selector: string) => Promise<HiveAgentLocalProject>,
    createClient: (origin: string) => Pick<HiveRuntimeCloudAccountClient, 'getCurrentIdentity'> = (
      origin
    ) => new HiveRuntimeCloudAccountClient(origin),
    private readonly now: () => number = Date.now
  ) {
    this.unsubscribeAccount = account.subscribeRuntimeCloudAuthorization(() => this.revision++)
    let previous = ''
    this.unsubscribeOwnership = ownership.subscribe((state) => {
      const signature = JSON.stringify([
        state.relation,
        state.accountId,
        state.sessionGeneration,
        state.runtimeRecordId,
        ['FENCED', 'STOPPED', 'DISABLED'].includes(state.presence)
      ])
      if (signature !== previous) {
        previous = signature
        this.revision++
      }
    })
    this.identity = new HiveAiCloudOperation(
      account,
      getConfig,
      async (origin, authorization, signal, assertCurrent) => {
        const identity = hiveAgentLocalIdentitySchema.parse(
          await createClient(origin).getCurrentIdentity(authorization.accessToken, signal)
        )
        assertCurrent()
        if (
          identity.accountId !== authorization.accountId ||
          identity.authorityId !== authorization.authorityId
        ) {
          throw forbidden()
        }
        return { origin, authorization, identity }
      },
      this.lifetime.signal
    )
  }

  eligibilityRevision(): number {
    return this.revision
  }

  private requireOwner() {
    const authorization = this.account.getRuntimeCloudAuthorization()
    const owner = this.ownership.getState()
    if (
      this.stopped ||
      !authorization ||
      authorization.sessionExpiresAt <= this.now() ||
      owner.relation !== 'CLAIMED_BY_CURRENT' ||
      !owner.runtimeRecordId ||
      owner.accountId !== authorization.accountId ||
      owner.sessionGeneration !== authorization.sessionGeneration ||
      ['FENCED', 'STOPPED', 'DISABLED'].includes(owner.presence)
    ) {
      throw forbidden()
    }
    return { authorization, owner }
  }

  async bindProject(selector: string) {
    const initial = this.requireOwner()
    const revision = this.revision
    const project = await this.resolveProject(selector)
    project.assertCurrent()
    if (revision !== this.revision) {
      throw forbidden()
    }
    const proof = await this.identity.run()
    const expiry = Math.min(
      proof.identity.expiresAt,
      proof.authorization.sessionExpiresAt,
      this.now() + 60_000
    )
    const principal: AuthenticatedRuntimePrincipal = Object.freeze({
      kind: 'local',
      accountId: proof.identity.accountId,
      deviceId: proof.identity.deviceId,
      runtimeRecordId: initial.owner.runtimeRecordId!,
      projectScope: project.projectScope,
      expiry,
      eligibilityRevision: revision,
      allowedMethods: Object.freeze(Object.keys(HIVE_AGENT_METHODS)),
      toolScopes: Object.freeze([])
    })
    let revoked = false
    const resolvePrincipal = () => {
      if (revoked) {
        return null
      }
      try {
        const current = this.requireOwner()
        const configured = this.getConfig()
        if (
          revision !== this.revision ||
          expiry <= this.now() ||
          current.owner.runtimeRecordId !== principal.runtimeRecordId ||
          current.authorization.accountId !== principal.accountId ||
          current.authorization.authorityId !== proof.authorization.authorityId ||
          current.authorization.sessionGeneration !== proof.authorization.sessionGeneration ||
          current.authorization.accessToken !== proof.authorization.accessToken ||
          !configured.configured ||
          configured.config.apiBaseUrl !== proof.origin
        ) {
          throw forbidden()
        }
        project.assertCurrent()
        return principal
      } catch {
        revoked = true
        return null
      }
    }
    if (!resolvePrincipal()) {
      throw forbidden()
    }
    return Object.freeze({
      projectScope: project.projectScope,
      workspaceKind: project.workspaceKind,
      resolvePrincipal,
      assertAuthorized(scope: ManagedPiSessionScope) {
        if (
          !resolvePrincipal() ||
          scope.accountId !== principal.accountId ||
          scope.deviceId !== principal.deviceId ||
          scope.runtimeRecordId !== principal.runtimeRecordId ||
          scope.projectScope !== principal.projectScope ||
          scope.workspaceKind !== project.workspaceKind
        ) {
          throw forbidden()
        }
      }
    })
  }

  stop(): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.lifetime.abort()
    this.revision++
    this.unsubscribeAccount()
    this.unsubscribeOwnership()
  }
}
