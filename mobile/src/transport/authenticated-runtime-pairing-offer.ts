import { RuntimeRecordIdSchema, type PairingOffer } from './types'

export function offerWithAuthenticatedRuntimeRecordId(
  offer: PairingOffer,
  status: unknown
): PairingOffer {
  const { runtimeRecordId: offeredRuntimeRecordId, ...withoutRuntimeRecordId } = offer
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return withoutRuntimeRecordId
  }
  const statusRecord = status as { runtimeRecordId?: unknown }
  if (statusRecord.runtimeRecordId === undefined) {
    return withoutRuntimeRecordId
  }
  if (typeof statusRecord.runtimeRecordId !== 'string') {
    throw new Error('authenticated Runtime returned an invalid runtimeRecordId')
  }
  if (offeredRuntimeRecordId && offeredRuntimeRecordId !== statusRecord.runtimeRecordId) {
    throw new Error('pairing offer Runtime identity does not match the authenticated Runtime')
  }
  const parsed = RuntimeRecordIdSchema.safeParse(statusRecord.runtimeRecordId)
  if (!parsed.success) {
    throw new Error('authenticated Runtime returned an invalid runtimeRecordId')
  }
  return { ...withoutRuntimeRecordId, runtimeRecordId: parsed.data }
}
