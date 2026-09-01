import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveRuntimeCredentialState,
  HiveRuntimeDirectoryPresence,
  HiveRuntimeDirectoryReadiness
} from '../../shared/hive-runtime-cloud'
import { isNormalizedHiveRuntimeDisplayName } from '../../shared/hive-runtime-display-name'
import { isRecord, positiveInteger, uuid } from './hive-runtime-cloud-response'

const CREDENTIAL_STATES = new Set<HiveRuntimeCredentialState>([
  'ACTIVE',
  'EXPIRING',
  'ROTATING',
  'EXPIRED',
  'REVOKED',
  'COMPROMISED',
  'IDENTITY_PROOF',
  'UNAVAILABLE'
])

function text(value: unknown, maximum = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return value
}

function optionalText(value: unknown, maximum = 512): string | null {
  return value === null || value === undefined ? null : text(value, maximum)
}

function optionalDisplayName(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (!isNormalizedHiveRuntimeDisplayName(value)) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return value
}

function instant(value: unknown): number {
  const parsed = Date.parse(text(value, 64))
  if (!Number.isFinite(parsed)) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return parsed
}

function optionalInstant(value: unknown): number | null {
  return value === null || value === undefined ? null : instant(value)
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  const result = value.map((entry) => text(entry, 128))
  if (new Set(result).size !== result.length) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return result
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return value
}

function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = nonNegativeIntegerOrNull(value)
  if (parsed === 0) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return parsed
}

function presence(value: unknown): HiveRuntimeDirectoryPresence {
  if (value !== 'ONLINE' && value !== 'DEGRADED' && value !== 'OFFLINE') {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return value
}

function readiness(value: unknown): HiveRuntimeDirectoryReadiness | null {
  if (value === null || value === undefined) {
    return null
  }
  if (
    !['STARTING', 'READY', 'DEGRADED', 'RECOVERING', 'STOPPED', 'ERROR'].includes(String(value))
  ) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return value as HiveRuntimeDirectoryReadiness
}

function credentialState(value: unknown): HiveRuntimeCredentialState {
  if (value === null || value === undefined) {
    return 'UNAVAILABLE'
  }
  if (!CREDENTIAL_STATES.has(value as HiveRuntimeCredentialState)) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return value as HiveRuntimeCredentialState
}

function clientAuthMode(value: unknown): 'MTLS' | 'IDENTITY_PROOF' | null {
  if (value === null || value === undefined) {
    return null
  }
  if (value !== 'MTLS' && value !== 'IDENTITY_PROOF') {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return value
}

function normalizeEntry(value: unknown): HiveAccountRuntimeDirectoryEntry {
  if (!isRecord(value)) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  if (
    value.status !== 'CLAIMED' ||
    (value.runtimeProtocolVersion !== 2 && value.runtimeProtocolVersion !== 3)
  ) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  const projection = value.projection
  if (projection !== null && projection !== undefined && !isRecord(projection)) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  const createdAt = instant(value.createdAt)
  const updatedAt = instant(value.updatedAt)
  if (updatedAt < createdAt) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  const projected = projection ?? {}
  const topLevelConnections = value.connectionCapabilities
  const projectedConnections = projected.connectionCapabilities
  const cloudDisplayName = optionalDisplayName(value.cloudDisplayName)
  const cloudDisplayNameVersion = positiveIntegerOrNull(value.cloudDisplayNameVersion)
  if (cloudDisplayName !== null && cloudDisplayNameVersion === null) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return {
    runtimeRecordId: uuid(value.runtimeRecordId),
    status: 'CLAIMED',
    runtimeVersion: text(value.runtimeVersion, 128),
    runtimeProtocolVersion: value.runtimeProtocolVersion,
    capabilities: strings(value.capabilities),
    resourceVersion: positiveInteger(value.resourceVersion),
    createdAt,
    updatedAt,
    claimedAt: optionalInstant(value.claimedAt),
    presence: presence(value.presence),
    readiness: readiness(projected.readiness),
    readinessReasonCode: optionalText(projected.readinessReasonCode, 128),
    lastHeartbeatAt:
      optionalInstant(value.lastHeartbeatAt) ?? optionalInstant(projected.observedAt),
    observedAt: optionalInstant(projected.observedAt),
    freeDiskBytes: nonNegativeIntegerOrNull(value.freeDiskBytes ?? projected.freeDiskBytes),
    clientAuthMode: clientAuthMode(value.clientAuthMode),
    credentialState: credentialState(value.credentialState),
    connectionCapabilities:
      topLevelConnections !== undefined
        ? strings(topLevelConnections)
        : projectedConnections !== undefined
          ? strings(projectedConnections)
          : [],
    cloudDisplayName,
    cloudDisplayNameVersion,
    deviceName: optionalText(value.deviceName, 255),
    osName: optionalText(value.osName, 64),
    osVersion: optionalText(value.osVersion, 128),
    osArch: optionalText(value.osArch, 32),
    cpuModel: optionalText(value.cpuModel, 255),
    cpuLogicalCores: positiveIntegerOrNull(value.cpuLogicalCores),
    totalMemoryBytes: positiveIntegerOrNull(value.totalMemoryBytes),
    lastSeenIp: optionalText(value.lastSeenIp, 45)
  }
}

export function normalizeRuntimeDirectoryPage(
  value: unknown
): readonly HiveAccountRuntimeDirectoryEntry[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('invalid_hive_runtime_cloud_directory_response')
  }
  return value.items.map(normalizeEntry)
}

export function normalizeRuntimeDirectoryEntry(value: unknown): HiveAccountRuntimeDirectoryEntry {
  return normalizeEntry(value)
}
