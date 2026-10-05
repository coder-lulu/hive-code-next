import { isNormalizedHiveRuntimeDisplayName } from './hive-runtime-display-name'

export const RUNTIME_DISPLAY_METADATA_PROTOCOL = 'web-session-display-metadata/v1' as const
export const RUNTIME_DISPLAY_METADATA_PROOF_PROTOCOL =
  'hive-runtime-web-session-display-metadata/v1'
export const RUNTIME_DISPLAY_METADATA_PATH = '/hive/v1/runtime-web-sessions/display-metadata'

export type RuntimeDisplayMetadata = Readonly<{
  runtimeRecordId: string
  resourceVersion: number
  ownershipEpoch: number
  cloudDisplayName: string | null
  cloudDisplayNameVersion: number
  deviceName: string | null
}>

export type RuntimeWebSessionDisplayMetadata = Readonly<{
  protocolVersion: typeof RUNTIME_DISPLAY_METADATA_PROTOCOL
  managedWebSessionId: string
  runtimeSessionId: string
  status: 'ACTIVE'
  controlVersion: number
  runtimeDisplayMetadata: RuntimeDisplayMetadata
}>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function invalid(): never {
  throw new Error('runtime_display_metadata_response_invalid')
}

function isMetadataObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!isMetadataObject(value)) {
    return invalid()
  }
  const record = value
  if (
    Object.keys(record).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(record, key))
  ) {
    return invalid()
  }
  return record
}

function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return invalid()
  }
  return value
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    return invalid()
  }
  return value
}

export function parseRuntimeDisplayMetadata(value: unknown): RuntimeDisplayMetadata {
  const record = exact(value, [
    'runtimeRecordId',
    'resourceVersion',
    'ownershipEpoch',
    'cloudDisplayName',
    'cloudDisplayNameVersion',
    'deviceName'
  ])
  if (
    record.cloudDisplayName !== null &&
    !isNormalizedHiveRuntimeDisplayName(record.cloudDisplayName)
  ) {
    return invalid()
  }
  if (
    record.deviceName !== null &&
    (typeof record.deviceName !== 'string' ||
      !record.deviceName.trim() ||
      record.deviceName.length > 256 ||
      [...record.deviceName].some((character) => {
        const code = character.charCodeAt(0)
        return code <= 31 || (code >= 127 && code <= 159)
      }))
  ) {
    return invalid()
  }
  return {
    runtimeRecordId: uuid(record.runtimeRecordId),
    resourceVersion: positive(record.resourceVersion),
    ownershipEpoch: positive(record.ownershipEpoch),
    cloudDisplayName: record.cloudDisplayName,
    cloudDisplayNameVersion: positive(record.cloudDisplayNameVersion),
    deviceName: record.deviceName
  }
}

export function parseRuntimeWebSessionDisplayMetadata(
  value: unknown
): RuntimeWebSessionDisplayMetadata {
  const record = exact(value, [
    'protocolVersion',
    'managedWebSessionId',
    'runtimeSessionId',
    'status',
    'controlVersion',
    'runtimeDisplayMetadata'
  ])
  if (record.protocolVersion !== RUNTIME_DISPLAY_METADATA_PROTOCOL || record.status !== 'ACTIVE') {
    return invalid()
  }
  return {
    protocolVersion: RUNTIME_DISPLAY_METADATA_PROTOCOL,
    managedWebSessionId: uuid(record.managedWebSessionId),
    runtimeSessionId: uuid(record.runtimeSessionId),
    status: 'ACTIVE',
    controlVersion: positive(record.controlVersion),
    runtimeDisplayMetadata: parseRuntimeDisplayMetadata(record.runtimeDisplayMetadata)
  }
}
