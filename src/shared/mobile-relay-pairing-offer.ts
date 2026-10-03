import { z } from 'zod'
import {
  PAIRING_DEVICE_TOKEN_MAX_CHARACTERS,
  PAIRING_ENDPOINT_MAX_CHARACTERS,
  PAIRING_PUBLIC_KEY_MAX_CHARACTERS
} from './mobile-pairing-protocol-limits'

export const PAIRING_OFFER_VERSION = 2
export const CANONICAL_RUNTIME_RECORD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const PairingOfferSchema = z
  .object({
    v: z.literal(PAIRING_OFFER_VERSION),
    endpoint: z.string().min(1).max(PAIRING_ENDPOINT_MAX_CHARACTERS),
    deviceToken: z.string().min(1).max(PAIRING_DEVICE_TOKEN_MAX_CHARACTERS),
    publicKeyB64: z.string().min(1).max(PAIRING_PUBLIC_KEY_MAX_CHARACTERS),
    pairedDeviceId: z.string().min(1).max(128).optional(),
    runtimeRecordId: z.string().regex(CANONICAL_RUNTIME_RECORD_ID_PATTERN).optional(),
    scope: z.enum(['mobile', 'runtime']).optional()
  })
  .strict()
export type PairingOffer = z.infer<typeof PairingOfferSchema>
