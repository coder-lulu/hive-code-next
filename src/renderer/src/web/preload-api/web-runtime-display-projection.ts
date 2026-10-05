import type { StoredWebRuntimeEnvironment } from '../web-runtime-environment'
import type * as AppStoreModule from '@/store'
import { redactStoredWebRuntimeEnvironment } from '../web-runtime-environment'
import type { WebAccountBootstrap } from '../account-runtime-relay/WebAccountConnect'
import type { CloudLaunchBootstrap } from '../cloud-launch-bootstrap'
import {
  parseRuntimeDisplayMetadata,
  type RuntimeDisplayMetadata
} from '../../../../shared/runtime-display-metadata'
import { resolveHiveRuntimeDisplayName } from '../../../../shared/hive-runtime-display-name'

type DisplayState = {
  activeEnvironment: StoredWebRuntimeEnvironment | null
  activeAccountBootstrap: WebAccountBootstrap | null
  activeCloudBootstrap: CloudLaunchBootstrap | null
}

export class WebRuntimeDisplayMetadataError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterMs?: number
  ) {
    super('Runtime display metadata unavailable')
  }
}

export type WebRuntimeDisplayOwner = Readonly<{
  generation: number
  environmentId: string
  runtimeRecordId: string
  ownershipEpoch: number
  account: WebAccountBootstrap | null
  cloud: CloudLaunchBootstrap | null
  accountGeneration: number | null
}>

/** The single name projection for a Web session. Does not replace its bootstrap or connection owner. */
export class WebRuntimeDisplayProjection {
  generation = 0
  private metadata: RuntimeDisplayMetadata | null = null
  private readonly environmentGenerations = new WeakMap<StoredWebRuntimeEnvironment, number>()
  private storePromise: Promise<typeof AppStoreModule> | null = null

  constructor(
    private readonly state: DisplayState,
    private readonly removeEnvironment: () => void
  ) {}

  reset(account: WebAccountBootstrap | null, cloud: CloudLaunchBootstrap | null): void {
    this.generation++
    this.metadata = account
      ? parseRuntimeDisplayMetadata({
          runtimeRecordId: account.runtime.runtimeRecordId,
          resourceVersion: account.runtime.resourceVersion,
          ownershipEpoch: account.runtime.ownershipEpoch,
          cloudDisplayName: account.runtime.cloudDisplayName,
          cloudDisplayNameVersion: account.runtime.cloudDisplayNameVersion,
          deviceName: account.runtime.deviceName ?? null
        })
      : cloud
        ? parseRuntimeDisplayMetadata(cloud.runtimeDisplayMetadata)
        : null
  }

  track(environment: StoredWebRuntimeEnvironment): void {
    this.environmentGenerations.set(environment, this.generation)
  }

  currentEnvironment(environment: StoredWebRuntimeEnvironment): boolean {
    const current = this.state.activeEnvironment
    const generation = this.environmentGenerations.get(environment)
    return (
      !!current &&
      current.id === environment.id &&
      current.createdAt === environment.createdAt &&
      current.pairingRevision === environment.pairingRevision &&
      (generation == null || generation === this.generation)
    )
  }

  capture(): WebRuntimeDisplayOwner | null {
    const {
      activeEnvironment: environment,
      activeAccountBootstrap: account,
      activeCloudBootstrap: cloud
    } = this.state
    if (!environment || !this.metadata || (!account && !cloud)) {
      return null
    }
    return {
      generation: this.generation,
      environmentId: environment.id,
      runtimeRecordId: this.metadata.runtimeRecordId,
      ownershipEpoch: this.metadata.ownershipEpoch,
      account,
      cloud,
      accountGeneration: account?.session.identityGeneration ?? null
    }
  }

  current(owner: WebRuntimeDisplayOwner): boolean {
    return (
      this.sameScope(owner) &&
      (!owner.account || owner.account.session.isCurrentIdentity(owner.accountGeneration!))
    )
  }

  async merge(owner: WebRuntimeDisplayOwner, value: unknown): Promise<boolean> {
    if (!this.current(owner) || !this.metadata) {
      return false
    }
    const incoming = parseRuntimeDisplayMetadata(value)
    if (incoming.runtimeRecordId !== owner.runtimeRecordId) {
      throw new WebRuntimeDisplayMetadataError('runtime_display_metadata_unverifiable')
    }
    if (incoming.ownershipEpoch !== owner.ownershipEpoch) {
      throw new WebRuntimeDisplayMetadataError('runtime_display_metadata_binding_invalid')
    }
    const previous = this.metadata
    if (
      incoming.cloudDisplayNameVersion === previous.cloudDisplayNameVersion &&
      incoming.cloudDisplayName !== previous.cloudDisplayName
    ) {
      throw new WebRuntimeDisplayMetadataError('runtime_display_metadata_unverifiable')
    }
    this.metadata = {
      ...previous,
      resourceVersion: Math.max(previous.resourceVersion, incoming.resourceVersion),
      deviceName:
        incoming.resourceVersion >= previous.resourceVersion
          ? incoming.deviceName
          : previous.deviceName,
      ...(incoming.cloudDisplayNameVersion > previous.cloudDisplayNameVersion
        ? {
            cloudDisplayName: incoming.cloudDisplayName,
            cloudDisplayNameVersion: incoming.cloudDisplayNameVersion
          }
        : {})
    }
    const environment = {
      ...this.state.activeEnvironment!,
      name: resolveHiveRuntimeDisplayName({
        ...this.metadata,
        reportedDeviceName: this.metadata.deviceName
      })
    }
    this.track(environment)
    this.state.activeEnvironment = environment
    await this.publish(environment)
    return this.current(owner)
  }

  clear(owner: WebRuntimeDisplayOwner): void {
    if (!this.sameScope(owner)) {
      return
    }
    this.removeEnvironment()
    void this.publish(null).catch(() => undefined)
  }

  async publish(environment: StoredWebRuntimeEnvironment | null): Promise<void> {
    const generation = this.generation
    const pending = (this.storePromise ??= import('@/store'))
    let store
    try {
      store = await pending
    } catch (error) {
      if (this.storePromise === pending) {
        this.storePromise = null
      }
      throw error
    }
    if (generation === this.generation && this.state.activeEnvironment === environment) {
      store.useAppStore
        .getState()
        .setRuntimeEnvironments(environment ? [redactStoredWebRuntimeEnvironment(environment)] : [])
    }
  }

  private sameScope(owner: WebRuntimeDisplayOwner): boolean {
    return (
      owner.generation === this.generation &&
      this.state.activeEnvironment?.id === owner.environmentId &&
      this.state.activeAccountBootstrap === owner.account &&
      this.state.activeCloudBootstrap === owner.cloud &&
      this.metadata?.runtimeRecordId === owner.runtimeRecordId &&
      this.metadata.ownershipEpoch === owner.ownershipEpoch
    )
  }
}
