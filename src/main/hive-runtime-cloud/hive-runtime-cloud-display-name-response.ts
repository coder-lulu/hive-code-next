import { isNormalizedHiveRuntimeDisplayName } from '../../shared/hive-runtime-display-name'
import { isRecord, positiveInteger, uuid } from './hive-runtime-cloud-response'

export type HiveRuntimeDisplayNamePatchResponse = Readonly<{
  runtimeRecordId: string
  cloudDisplayName: string | null
  cloudDisplayNameVersion: number
  updatedAt: number
}>

export function normalizeRuntimeDisplayNamePatchResponse(
  value: unknown
): HiveRuntimeDisplayNamePatchResponse {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        !['runtimeRecordId', 'cloudDisplayName', 'cloudDisplayNameVersion', 'updatedAt'].includes(
          key
        )
    ) ||
    Object.keys(value).length !== 4 ||
    (value.cloudDisplayName !== null &&
      !isNormalizedHiveRuntimeDisplayName(value.cloudDisplayName)) ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('invalid_hive_runtime_cloud_display_name_response')
  }
  const updatedAt = Date.parse(value.updatedAt)
  if (!Number.isFinite(updatedAt)) {
    throw new Error('invalid_hive_runtime_cloud_display_name_response')
  }
  return {
    runtimeRecordId: uuid(value.runtimeRecordId),
    cloudDisplayName: value.cloudDisplayName,
    cloudDisplayNameVersion: positiveInteger(value.cloudDisplayNameVersion),
    updatedAt
  }
}
