/* eslint-disable max-lines -- Why: the account Runtime slice keeps directory projection,
   catalog refresh, and pending-alias reconciliation in one atomic Zustand boundary. */
import type { StateCreator } from 'zustand'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
  projectHiveRuntimeAccountClaim,
  type HiveAccountRuntimeDirectoryState,
  type HiveLocalRuntimeOwnershipState,
  type HiveRuntimeDisplayNameUpdateRequest
} from '../../../../shared/hive-runtime-cloud'
import { resolveHiveRuntimeDisplayName } from '../../../../shared/hive-runtime-display-name'
import type {
  PublicKnownRuntimeEnvironment,
  RuntimeEnvironmentAccountClaim
} from '../../../../shared/runtime-environments'
import type { AppState } from '../types'

export type AccountRuntimeCloudSlice = {
  accountRuntimeDirectory: HiveAccountRuntimeDirectoryState
  localRuntimeOwnership: HiveLocalRuntimeOwnershipState
  startAccountRuntimeCloudSync: () => () => void
  refreshAccountRuntimeCloud: () => Promise<void>
  updateAccountRuntimeDisplayName: (request: HiveRuntimeDisplayNameUpdateRequest) => Promise<void>
  refreshLocalRuntimeOwnership: () => Promise<HiveLocalRuntimeOwnershipState>
  claimLocalRuntimeForAccount: (
    expectedAccountId: string
  ) => Promise<HiveLocalRuntimeOwnershipState>
}

export class AccountRuntimeClaimError extends Error {
  constructor(readonly code: string | null) {
    super('hive_runtime_cloud_claim_failed')
    this.name = 'AccountRuntimeClaimError'
  }
}

export function accountRuntimeCatalogAccessFingerprint(
  directory: HiveAccountRuntimeDirectoryState,
  localRuntimeRecordId: string | null = null
): string {
  const runtimes = directory.items
    .map(
      (runtime) =>
        [
          runtime.runtimeRecordId,
          runtime.resourceVersion,
          runtime.cloudDisplayNameVersion ?? null,
          runtime.cloudDisplayName ?? null
        ] as const
    )
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  const pending = (directory.pendingDisplayNames ?? [])
    .map(
      (entry) =>
        [entry.runtimeRecordId, entry.revision, entry.desiredName, entry.confirmed] as const
    )
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return JSON.stringify([
    directory.accountId,
    directory.sessionGeneration,
    runtimes,
    pending,
    localRuntimeRecordId
  ])
}

export function projectAccountRuntimeDirectoryOntoCatalog(
  environments: readonly PublicKnownRuntimeEnvironment[],
  directory: HiveAccountRuntimeDirectoryState
): readonly PublicKnownRuntimeEnvironment[] {
  if (environments.length === 0) {
    return environments
  }
  const runtimeById = new Map(directory.items.map((runtime) => [runtime.runtimeRecordId, runtime]))
  const pendingById = new Map(
    (directory.pendingDisplayNames ?? []).map((pending) => [
      pending.runtimeRecordId,
      pending.desiredName
    ])
  )
  let changed = false
  const projected = environments.flatMap((environment): PublicKnownRuntimeEnvironment[] => {
    const runtimeRecordId = environment.accountClaim?.runtimeRecordId
    const runtime = runtimeRecordId ? runtimeById.get(runtimeRecordId) : undefined
    if (!runtime) {
      if (!environment.accountClaim) {
        return [environment]
      }
      changed = true
      if (environment.accessSources?.includes('local-pairing') !== true) {
        return []
      }
      const { accountClaim: _accountClaim, ...localEnvironment } = environment
      return [{ ...localEnvironment, accessSources: ['local-pairing'] }]
    }
    const accountClaim = projectHiveRuntimeAccountClaim(runtime)
    const accountOnly = environment.accessSources?.includes('local-pairing') !== true
    const name = accountOnly
      ? resolveHiveRuntimeDisplayName({
          ...(pendingById.has(runtime.runtimeRecordId)
            ? { pendingDesiredName: pendingById.get(runtime.runtimeRecordId)! }
            : {}),
          cloudDisplayName: runtime.cloudDisplayName,
          reportedDeviceName: runtime.deviceName,
          runtimeRecordId: runtime.runtimeRecordId
        })
      : environment.name
    const updatedAt = accountOnly ? runtime.updatedAt : environment.updatedAt
    const lastUsedAt = accountOnly ? runtime.lastHeartbeatAt : environment.lastUsedAt
    const pairingRevision = accountOnly ? runtime.resourceVersion : environment.pairingRevision
    if (
      environment.name === name &&
      environment.updatedAt === updatedAt &&
      environment.lastUsedAt === lastUsedAt &&
      environment.pairingRevision === pairingRevision &&
      runtimeAccountClaimsEqual(environment.accountClaim, accountClaim)
    ) {
      return [environment]
    }
    changed = true
    return [
      {
        ...environment,
        name,
        updatedAt,
        lastUsedAt,
        pairingRevision,
        accountClaim
      }
    ]
  })
  return changed ? projected : environments
}

function runtimeAccountClaimsEqual(
  left: RuntimeEnvironmentAccountClaim | undefined,
  right: RuntimeEnvironmentAccountClaim
): boolean {
  return Boolean(
    left &&
    left.runtimeRecordId === right.runtimeRecordId &&
    left.resourceVersion === right.resourceVersion &&
    left.presence === right.presence &&
    left.readiness === right.readiness &&
    left.readinessReasonCode === right.readinessReasonCode &&
    left.lastHeartbeatAt === right.lastHeartbeatAt &&
    left.freeDiskBytes === right.freeDiskBytes &&
    left.clientAuthMode === right.clientAuthMode &&
    left.credentialState === right.credentialState &&
    left.cloudConnectable === right.cloudConnectable &&
    left.cloudDisplayName === right.cloudDisplayName &&
    left.cloudDisplayNameVersion === right.cloudDisplayNameVersion &&
    left.reportedDeviceName === right.reportedDeviceName &&
    stringArraysEqual(left.connectionCapabilities, right.connectionCapabilities)
  )
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function shouldApplyOwnershipReply(
  current: HiveLocalRuntimeOwnershipState,
  incoming: HiveLocalRuntimeOwnershipState,
  generationUnchanged: boolean
): boolean {
  if (generationUnchanged) {
    return true
  }
  if (
    current.accountId !== incoming.accountId ||
    current.sessionGeneration !== incoming.sessionGeneration
  ) {
    return false
  }
  return incoming.stateRevision > current.stateRevision
}

export const createAccountRuntimeCloudSlice: StateCreator<
  AppState,
  [],
  [],
  AccountRuntimeCloudSlice
> = (set, get) => {
  let directoryGeneration = 0
  let ownershipGeneration = 0
  let runtimeCatalogGeneration = 0
  let runtimeCatalogFingerprint: string | null = accountRuntimeCatalogAccessFingerprint(
    EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY
  )

  const reloadRuntimeEnvironmentCatalog = (
    directory: HiveAccountRuntimeDirectoryState,
    isDisposed: () => boolean = () => false
  ): void => {
    const fingerprint = accountRuntimeCatalogAccessFingerprint(
      directory,
      get().localRuntimeOwnership.runtimeRecordId
    )
    if (runtimeCatalogFingerprint === fingerprint) {
      return
    }
    runtimeCatalogFingerprint = fingerprint
    const generation = ++runtimeCatalogGeneration
    void window.api.runtimeEnvironments
      .list()
      .then((environments) => {
        if (
          !isDisposed() &&
          generation === runtimeCatalogGeneration &&
          accountRuntimeCatalogAccessFingerprint(
            get().accountRuntimeDirectory,
            get().localRuntimeOwnership.runtimeRecordId
          ) === fingerprint
        ) {
          get().setRuntimeEnvironments(environments)
        }
      })
      .catch(() => {
        if (generation === runtimeCatalogGeneration) {
          // Allow the next directory refresh to retry the failed catalog projection.
          runtimeCatalogFingerprint = null
        }
      })
  }

  const publishAccountRuntimeDirectory = (directory: HiveAccountRuntimeDirectoryState): void => {
    set((state) => ({
      accountRuntimeDirectory: directory,
      runtimeEnvironments: projectAccountRuntimeDirectoryOntoCatalog(
        state.runtimeEnvironments,
        directory
      )
    }))
  }

  const publishLocalRuntimeOwnership = (
    localRuntimeOwnership: HiveLocalRuntimeOwnershipState,
    isDisposed: () => boolean = () => false
  ): void => {
    set({ localRuntimeOwnership })
    reloadRuntimeEnvironmentCatalog(get().accountRuntimeDirectory, isDisposed)
  }

  return {
    accountRuntimeDirectory: EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
    localRuntimeOwnership: EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,

    startAccountRuntimeCloudSync: () => {
      const runtimeCloudApi = window.api.hiveRuntimeCloud
      // Packaged upgrade failures can leave renderer and preload artifacts at different revisions.
      // Runtime Cloud is optional in that mixed-version window; it must not take down the shell.
      if (!runtimeCloudApi) {
        return () => undefined
      }
      let disposed = false
      const unsubscribeDirectory = runtimeCloudApi.onDirectoryChanged((state) => {
        if (!disposed) {
          directoryGeneration += 1
          publishAccountRuntimeDirectory(state)
          reloadRuntimeEnvironmentCatalog(state, () => disposed)
        }
      })
      const unsubscribeOwnership = runtimeCloudApi.onOwnershipChanged((state) => {
        if (!disposed) {
          ownershipGeneration += 1
          publishLocalRuntimeOwnership(state, () => disposed)
        }
      })
      const initialDirectoryGeneration = directoryGeneration
      const initialOwnershipGeneration = ownershipGeneration
      reloadRuntimeEnvironmentCatalog(get().accountRuntimeDirectory, () => disposed)
      void runtimeCloudApi
        .getDirectory()
        .then((accountRuntimeDirectory) => {
          if (!disposed && directoryGeneration === initialDirectoryGeneration) {
            publishAccountRuntimeDirectory(accountRuntimeDirectory)
            reloadRuntimeEnvironmentCatalog(accountRuntimeDirectory, () => disposed)
          }
        })
        .catch(() => undefined)
      void runtimeCloudApi
        .getLocalOwnership()
        .then((localRuntimeOwnership) => {
          if (!disposed && ownershipGeneration === initialOwnershipGeneration) {
            publishLocalRuntimeOwnership(localRuntimeOwnership, () => disposed)
          }
        })
        .catch(() => undefined)
      return () => {
        disposed = true
        runtimeCatalogGeneration += 1
        runtimeCatalogFingerprint = null
        unsubscribeDirectory()
        unsubscribeOwnership()
      }
    },

    refreshAccountRuntimeCloud: async () => {
      const initialDirectoryGeneration = directoryGeneration
      const initialOwnershipGeneration = ownershipGeneration
      const [accountRuntimeDirectory, localRuntimeOwnership] = await Promise.all([
        window.api.hiveRuntimeCloud.refreshDirectory(),
        window.api.hiveRuntimeCloud.refreshLocalOwnership()
      ])
      if (directoryGeneration === initialDirectoryGeneration) {
        publishAccountRuntimeDirectory(accountRuntimeDirectory)
        reloadRuntimeEnvironmentCatalog(accountRuntimeDirectory)
      }
      if (ownershipGeneration === initialOwnershipGeneration) {
        publishLocalRuntimeOwnership(localRuntimeOwnership)
      }
    },

    updateAccountRuntimeDisplayName: async (request) => {
      const initialDirectoryGeneration = directoryGeneration
      const accountRuntimeDirectory = await window.api.hiveRuntimeCloud.updateDisplayName(request)
      if (directoryGeneration === initialDirectoryGeneration) {
        publishAccountRuntimeDirectory(accountRuntimeDirectory)
        reloadRuntimeEnvironmentCatalog(accountRuntimeDirectory)
      }
    },

    refreshLocalRuntimeOwnership: async () => {
      const initialOwnershipGeneration = ownershipGeneration
      const localRuntimeOwnership = await window.api.hiveRuntimeCloud.refreshLocalOwnership()
      const current = get().localRuntimeOwnership
      if (
        shouldApplyOwnershipReply(
          current,
          localRuntimeOwnership,
          ownershipGeneration === initialOwnershipGeneration
        )
      ) {
        publishLocalRuntimeOwnership(localRuntimeOwnership)
        return localRuntimeOwnership
      }
      return current
    },

    claimLocalRuntimeForAccount: async (expectedAccountId) => {
      const initialOwnershipGeneration = ownershipGeneration
      try {
        const localRuntimeOwnership = await window.api.hiveRuntimeCloud.claimLocalRuntime({
          expectedAccountId
        })
        const current = get().localRuntimeOwnership
        if (
          shouldApplyOwnershipReply(
            current,
            localRuntimeOwnership,
            ownershipGeneration === initialOwnershipGeneration
          )
        ) {
          publishLocalRuntimeOwnership(localRuntimeOwnership)
          return localRuntimeOwnership
        }
        return current
      } catch {
        let localRuntimeOwnership: HiveLocalRuntimeOwnershipState | null = null
        const snapshotGeneration = ownershipGeneration
        try {
          localRuntimeOwnership = await window.api.hiveRuntimeCloud.getLocalOwnership()
          const current = get().localRuntimeOwnership
          if (
            shouldApplyOwnershipReply(
              current,
              localRuntimeOwnership,
              ownershipGeneration === snapshotGeneration
            )
          ) {
            publishLocalRuntimeOwnership(localRuntimeOwnership)
          }
        } catch {
          // The stable renderer error below intentionally hides IPC and credential details.
        }
        const currentOwnership = get().localRuntimeOwnership
        if (currentOwnership.accountId !== expectedAccountId) {
          throw new AccountRuntimeClaimError('ACCOUNT_CHANGED')
        }
        throw new AccountRuntimeClaimError(currentOwnership.errorCode)
      }
    }
  }
}
