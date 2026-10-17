import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'
import { z } from 'zod'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { hostListMutationsSettled } from '../transport/host-list-mutation-queue'
import { readStoredHostProfilesForMutation } from '../transport/host-metadata-store'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'
import {
  clearUnlinkedRuntimeConnections,
  runtimeDeletionSupportedOnThisSurface
} from './mobile-runtime-delete-cleanup'

const PREFIX = 'hive:runtime-delete-recovery:'
const AliasSchema = z.object({
  hostId: z.string().min(1),
  pairingRevision: z.string().min(1).nullable()
})
export type CapturedRuntimeDeleteAlias = z.infer<typeof AliasSchema>
const RecoverySchema = z.object({
  runtimeRecordId: z.string().min(1),
  operationId: z.uuid(),
  expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.number().finite(),
  aliases: z.array(AliasSchema)
})
export type RuntimeDeleteRecoveryTarget = Pick<
  z.infer<typeof RecoverySchema>,
  'operationId' | 'expectedVersion'
>
export type RuntimeDeleteCleanupOutcome = 'completed' | 'superseded'
const recoveryFlights = new Map<string, Promise<unknown>>()

async function serializeRecovery<T>(recoveryKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = recoveryFlights.get(recoveryKey)
  const pending = (previous ?? Promise.resolve()).catch(() => undefined).then(operation)
  recoveryFlights.set(recoveryKey, pending)
  try {
    return await pending
  } finally {
    if (recoveryFlights.get(recoveryKey) === pending) {
      recoveryFlights.delete(recoveryKey)
    }
  }
}
function scopePrefix(session: MobileSession): string {
  return `${PREFIX}${encodeURIComponent(session.authorityId)}:${encodeURIComponent(session.account.accountId)}:`
}
function key(session: MobileSession, id: string): string {
  return `${scopePrefix(session)}${encodeURIComponent(id)}`
}

export async function prepareRuntimeDeleteRecovery(
  session: MobileSession,
  runtimeRecordId: string,
  expectedVersion: number
): Promise<RuntimeDeleteRecoveryTarget> {
  if (!runtimeDeletionSupportedOnThisSurface()) {
    throw new Error('runtime_deletion_requires_native_app')
  }
  RecoverySchema.shape.expectedVersion.parse(expectedVersion)
  return serializeRecovery(key(session, runtimeRecordId), async () => {
    await hostListMutationsSettled()
    const profiles = await readStoredHostProfilesForMutation()
    const previous = await AsyncStorage.getItem(key(session, runtimeRecordId))
    const aliases = new Map<string, CapturedRuntimeDeleteAlias>([
      [runtimeRecordId, { hostId: runtimeRecordId, pairingRevision: null }]
    ])
    if (previous) {
      const record = RecoverySchema.parse(JSON.parse(previous))
      if (record.runtimeRecordId !== runtimeRecordId) {
        throw new Error('runtime_delete_recovery_mismatch')
      }
      if (record.expectedVersion > expectedVersion) {
        throw new Error('runtime_delete_recovery_superseded')
      }
      for (const alias of record.aliases) {
        aliases.set(alias.hostId, alias)
      }
    }
    for (const profile of profiles) {
      if (profile.runtimeRecordId === runtimeRecordId || profile.id === runtimeRecordId) {
        aliases.set(profile.id, {
          hostId: profile.id,
          pairingRevision: profile.pairingRevision ?? null
        })
      }
    }
    const record = {
      runtimeRecordId,
      operationId: randomUUID(),
      expectedVersion,
      createdAt: Date.now(),
      aliases: [...aliases.values()]
    }
    await AsyncStorage.setItem(key(session, runtimeRecordId), JSON.stringify(record))
    return record
  })
}

export async function readRuntimeDeleteRecovery(session: MobileSession, runtimeRecordId: string) {
  const raw = await AsyncStorage.getItem(key(session, runtimeRecordId))
  if (!raw) {
    return null
  }
  const record = RecoverySchema.parse(JSON.parse(raw))
  if (record.runtimeRecordId !== runtimeRecordId) {
    throw new Error('runtime_delete_recovery_mismatch')
  }
  return record
}

export async function hasRuntimeDeleteRecovery(
  session: MobileSession,
  runtimeRecordId: string
): Promise<boolean> {
  return (await readRuntimeDeleteRecovery(session, runtimeRecordId)) !== null
}

export async function completeRuntimeDeleteRecovery(
  session: MobileSession,
  runtimeRecordId: string,
  forgetHostClient: (hostId: string) => void,
  isCurrent: () => boolean,
  options: {
    target: RuntimeDeleteRecoveryTarget
    confirmUnlinked?: (expectedVersion: number) => boolean
  }
): Promise<RuntimeDeleteCleanupOutcome> {
  return serializeRecovery(key(session, runtimeRecordId), async () => {
    const assertCurrent = () => {
      if (!isCurrent()) {
        throw new Error('mobile_session_required')
      }
    }
    assertCurrent()
    const record = await readRuntimeDeleteRecovery(session, runtimeRecordId)
    assertCurrent()
    if (
      record &&
      (record.operationId !== options.target.operationId ||
        record.expectedVersion !== options.target.expectedVersion)
    ) {
      return 'superseded'
    }
    if (options.confirmUnlinked && !options.confirmUnlinked(options.target.expectedVersion)) {
      if (record) {
        await AsyncStorage.removeItem(key(session, runtimeRecordId))
      }
      return 'superseded'
    }
    // Another current-scope caller may already have completed this exact task.
    if (!record) {
      return 'completed'
    }
    await clearUnlinkedRuntimeConnections(
      runtimeRecordId,
      forgetHostClient,
      isCurrent,
      record.aliases
    )
    assertCurrent()
    await AsyncStorage.removeItem(key(session, runtimeRecordId))
    return 'completed'
  })
}

export async function loadScopedRuntimeDeleteRecoveryAliases(
  session: MobileSession,
  runtimeRecordId: string
): Promise<readonly CapturedRuntimeDeleteAlias[]> {
  const record = await readRuntimeDeleteRecovery(session, runtimeRecordId)
  if (!record) {
    throw new Error('runtime_delete_recovery_required')
  }
  return record.aliases
}

export async function loadRuntimeDeleteRecoveryAliases(
  runtimeRecordId: string
): Promise<CapturedRuntimeDeleteAlias[]> {
  const keys = (await AsyncStorage.getAllKeys()).filter(
    (item) => item.startsWith(PREFIX) && item.endsWith(`:${encodeURIComponent(runtimeRecordId)}`)
  )
  if (keys.length !== 1) {
    throw new Error('runtime_delete_recovery_scope_required')
  }
  const aliases: CapturedRuntimeDeleteAlias[] = []
  for (const recoveryKey of keys) {
    const raw = await AsyncStorage.getItem(recoveryKey)
    if (!raw) {
      continue
    }
    const record = RecoverySchema.parse(JSON.parse(raw))
    if (record.runtimeRecordId === runtimeRecordId) {
      aliases.push(...record.aliases)
    }
  }
  return [...aliases]
}

export async function recoverRuntimeDeleteConnections(
  session: MobileSession,
  entries: readonly AccountRuntimeDirectoryEntry[],
  forgetHostClient: (hostId: string) => void,
  isCurrent: () => boolean,
  requestStartedAt = Date.now()
): Promise<void> {
  if (!runtimeDeletionSupportedOnThisSurface() || !isCurrent()) {
    return
  }
  const keys = (await AsyncStorage.getAllKeys()).filter((item) =>
    item.startsWith(scopePrefix(session))
  )
  const present = new Map(entries.map((entry) => [entry.runtimeRecordId, entry]))
  for (const recoveryKey of keys) {
    if (!isCurrent()) {
      return
    }
    const raw = await AsyncStorage.getItem(recoveryKey)
    if (!isCurrent()) {
      return
    }
    if (!raw) {
      continue
    }
    const record = RecoverySchema.parse(JSON.parse(raw))
    if (
      recoveryKey !== key(session, record.runtimeRecordId) ||
      record.createdAt >= requestStartedAt ||
      (present.get(record.runtimeRecordId)?.resourceVersion ?? Infinity) <= record.expectedVersion
    ) {
      continue
    }
    await completeRuntimeDeleteRecovery(
      session,
      record.runtimeRecordId,
      forgetHostClient,
      isCurrent,
      { target: record, confirmUnlinked: () => !present.has(record.runtimeRecordId) }
    )
    if (!isCurrent()) {
      return
    }
  }
}
