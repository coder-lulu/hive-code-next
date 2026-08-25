import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type HiveRuntimeCloudCurrentTuple = Readonly<{
  authorityGeneration: number
  runtimeRecordId: string
  runtimeInstanceId: string
  bootId: string
  heartbeatLeaseId: string
  leaseEpoch: number
  fencingEpoch: number
}>

export type HiveRuntimeCloudManagedWebSessionPrincipal = Readonly<{
  principalKind: 'cloud_managed_web_session'
  managedWebSessionId: string
  runtimeSessionId: string
  currentTuple: HiveRuntimeCloudCurrentTuple
  expiresAt: number
}>

export type HiveRuntimeCloudManagedSessionInvalidationReason =
  | 'EXPIRED'
  | 'TUPLE_FENCED'
  | 'REVOKED'
  | 'REMOVED'
  | 'CLEARED'
  | 'REPLACED'

export type HiveRuntimeCloudManagedSessionInvalidation = Readonly<{
  reason: HiveRuntimeCloudManagedSessionInvalidationReason
  principal: HiveRuntimeCloudManagedWebSessionPrincipal
}>

export type HiveRuntimeCloudManagedSessionRegistration = Readonly<{
  managedWebSessionId: string
  runtimeSessionId: string
  currentTuple: HiveRuntimeCloudCurrentTuple
  expiresAt: number
  sessionToken?: string
}>

export type HiveRuntimeCloudManagedSessionResolution = Readonly<{
  managedWebSessionId: string
  runtimeSessionId: string
  sessionToken: string
  currentTuple: HiveRuntimeCloudCurrentTuple
  now: number
}>

export type HiveRuntimeCloudManagedSessionBootstrap = Readonly<{
  sessionToken: string
  principal: HiveRuntimeCloudManagedWebSessionPrincipal
}>

export type HiveRuntimeCloudManagedSessionIdentifiers = Readonly<{
  managedWebSessionId: string
  runtimeSessionId: string
}>

type RegistryEntry = Readonly<{
  principal: HiveRuntimeCloudManagedWebSessionPrincipal
  tokenDigest: Buffer
}>

export type HiveRuntimeCloudManagedSessionRegistryOptions = Readonly<{
  onInvalidate?: (event: HiveRuntimeCloudManagedSessionInvalidation) => void
}>

function requireUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`invalid_${field}`)
  }
  return value
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`invalid_${field}`)
  }
  return value
}

function validatedTuple(tuple: HiveRuntimeCloudCurrentTuple): HiveRuntimeCloudCurrentTuple {
  return Object.freeze({
    authorityGeneration: requirePositiveInteger(tuple.authorityGeneration, 'authority_generation'),
    runtimeRecordId: requireUuid(tuple.runtimeRecordId, 'runtime_record_id'),
    runtimeInstanceId: requireUuid(tuple.runtimeInstanceId, 'runtime_instance_id'),
    bootId: requireUuid(tuple.bootId, 'boot_id'),
    heartbeatLeaseId: requireUuid(tuple.heartbeatLeaseId, 'heartbeat_lease_id'),
    leaseEpoch: requirePositiveInteger(tuple.leaseEpoch, 'lease_epoch'),
    fencingEpoch: requirePositiveInteger(tuple.fencingEpoch, 'fencing_epoch')
  })
}

function isSessionToken(value: string): boolean {
  if (!SESSION_TOKEN_PATTERN.test(value)) {
    return false
  }
  const decoded = Buffer.from(value, 'base64url')
  return decoded.byteLength === 32 && decoded.toString('base64url') === value
}

function requireSessionToken(value: string): string {
  if (!isSessionToken(value)) {
    throw new Error('invalid_cloud_managed_session_token')
  }
  return value
}

function tokenDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function tuplesEqual(
  left: HiveRuntimeCloudCurrentTuple,
  right: HiveRuntimeCloudCurrentTuple
): boolean {
  return (
    left.authorityGeneration === right.authorityGeneration &&
    left.runtimeRecordId === right.runtimeRecordId &&
    left.runtimeInstanceId === right.runtimeInstanceId &&
    left.bootId === right.bootId &&
    left.heartbeatLeaseId === right.heartbeatLeaseId &&
    left.leaseEpoch === right.leaseEpoch &&
    left.fencingEpoch === right.fencingEpoch
  )
}

export class HiveRuntimeCloudManagedSessionRegistry {
  private readonly entries = new Map<string, RegistryEntry>()
  private readonly onInvalidate: HiveRuntimeCloudManagedSessionRegistryOptions['onInvalidate']

  constructor(options: HiveRuntimeCloudManagedSessionRegistryOptions = {}) {
    this.onInvalidate = options.onInvalidate
  }

  get size(): number {
    return this.entries.size
  }

  register(
    input: HiveRuntimeCloudManagedSessionRegistration
  ): HiveRuntimeCloudManagedSessionBootstrap {
    const managedWebSessionId = requireUuid(input.managedWebSessionId, 'managed_web_session_id')
    const runtimeSessionId = requireUuid(input.runtimeSessionId, 'runtime_session_id')
    const currentTuple = validatedTuple(input.currentTuple)
    const expiresAt = requirePositiveInteger(input.expiresAt, 'managed_session_expires_at')
    const sessionToken = requireSessionToken(
      input.sessionToken ?? randomBytes(32).toString('base64url')
    )
    const principal = Object.freeze({
      principalKind: 'cloud_managed_web_session' as const,
      managedWebSessionId,
      runtimeSessionId,
      currentTuple,
      expiresAt
    })
    const previous = this.entries.get(managedWebSessionId)
    if (previous) {
      this.entries.delete(managedWebSessionId)
      this.notify(previous, 'REPLACED')
    }
    this.entries.set(managedWebSessionId, {
      principal,
      tokenDigest: tokenDigest(sessionToken)
    })
    return { sessionToken, principal }
  }

  resolve(
    input: HiveRuntimeCloudManagedSessionResolution
  ): HiveRuntimeCloudManagedWebSessionPrincipal | null {
    const entry = this.entries.get(input.managedWebSessionId)
    if (!entry || entry.principal.runtimeSessionId !== input.runtimeSessionId) {
      return null
    }
    if (entry.principal.expiresAt <= input.now) {
      this.invalidate(entry, 'EXPIRED')
      return null
    }
    if (!tuplesEqual(entry.principal.currentTuple, input.currentTuple)) {
      this.invalidate(entry, 'TUPLE_FENCED')
      return null
    }
    if (!isSessionToken(input.sessionToken)) {
      return null
    }
    const candidateDigest = tokenDigest(input.sessionToken)
    return timingSafeEqual(entry.tokenDigest, candidateDigest) ? entry.principal : null
  }

  revalidate(
    principal: HiveRuntimeCloudManagedSessionIdentifiers & Readonly<{ expiresAt: number }>,
    currentTuple: HiveRuntimeCloudCurrentTuple,
    now: number
  ): boolean {
    const entry = this.entries.get(principal.managedWebSessionId)
    if (
      !entry ||
      entry.principal.runtimeSessionId !== principal.runtimeSessionId ||
      entry.principal.expiresAt !== principal.expiresAt
    ) {
      return false
    }
    if (entry.principal.expiresAt <= now) {
      this.invalidate(entry, 'EXPIRED')
      return false
    }
    if (!tuplesEqual(entry.principal.currentTuple, currentTuple)) {
      this.invalidate(entry, 'TUPLE_FENCED')
      return false
    }
    return true
  }

  revoke(identifiers: HiveRuntimeCloudManagedSessionIdentifiers): boolean {
    return this.invalidateMatching(identifiers, 'REVOKED')
  }

  remove(identifiers: HiveRuntimeCloudManagedSessionIdentifiers): boolean {
    return this.invalidateMatching(identifiers, 'REMOVED')
  }

  fenceTuple(currentTuple: HiveRuntimeCloudCurrentTuple): number {
    const authoritativeTuple = validatedTuple(currentTuple)
    const stale = [...this.entries.values()].filter(
      (entry) => !tuplesEqual(entry.principal.currentTuple, authoritativeTuple)
    )
    for (const entry of stale) {
      this.entries.delete(entry.principal.managedWebSessionId)
    }
    this.notifyAll(stale, 'TUPLE_FENCED')
    return stale.length
  }

  clear(): number {
    const entries = [...this.entries.values()]
    this.entries.clear()
    this.notifyAll(entries, 'CLEARED')
    return entries.length
  }

  private invalidateMatching(
    identifiers: HiveRuntimeCloudManagedSessionIdentifiers,
    reason: HiveRuntimeCloudManagedSessionInvalidationReason
  ): boolean {
    const entry = this.entries.get(identifiers.managedWebSessionId)
    if (!entry || entry.principal.runtimeSessionId !== identifiers.runtimeSessionId) {
      return false
    }
    this.invalidate(entry, reason)
    return true
  }

  private invalidate(
    entry: RegistryEntry,
    reason: HiveRuntimeCloudManagedSessionInvalidationReason
  ): void {
    this.entries.delete(entry.principal.managedWebSessionId)
    this.notify(entry, reason)
  }

  private notify(
    entry: RegistryEntry,
    reason: HiveRuntimeCloudManagedSessionInvalidationReason
  ): void {
    this.onInvalidate?.(Object.freeze({ reason, principal: entry.principal }))
  }

  private notifyAll(
    entries: readonly RegistryEntry[],
    reason: HiveRuntimeCloudManagedSessionInvalidationReason
  ): void {
    let firstError: unknown
    for (const entry of entries) {
      try {
        this.notify(entry, reason)
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) {
      throw firstError
    }
  }
}
