import nacl from 'tweetnacl'
import { z } from 'zod'
import { sha256 } from './sha256'

const Uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const Id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const Integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Key = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
export type HiveAccountRelayClientKind = 'DESKTOP' | 'MOBILE' | 'WEB'

export function hiveAccountRelayOrigin(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.origin !== value ||
    url.username ||
    url.password ||
    url.hostname.length > 253 ||
    url.hostname
      .split('.')
      .some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
    throw new Error('Invalid Relay origin')
  }
  return url.origin
}

export const HiveAccountRelayIntentRequestSchema = z
  .object({
    protocolVersion: z.literal(2),
    idempotencyKey: Uuid,
    expectedResourceVersion: Integer.min(1),
    clientKind: z.enum(['DESKTOP', 'MOBILE', 'WEB']),
    clientPublicKeyB64: Key,
    ticketSecretSha256: Key
  })
  .strict()
export type HiveAccountRelayIntentRequest = z.infer<typeof HiveAccountRelayIntentRequestSchema>

const IntentResponse = z
  .object({
    protocolVersion: z.literal(2),
    intentId: Uuid,
    ticketId: Uuid,
    expiresAt: Integer,
    cellUrl: z.string().max(2048),
    cellId: Id,
    cellIncarnationId: Uuid,
    assignmentId: Uuid,
    assignmentEpoch: Integer,
    relayHostId: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    clientAdmissionToken: z
      .string()
      .min(1)
      .max(8192)
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/),
    runtimePublicKeyB64: Key,
    e2eeFraming: z.literal('hive-relay-e2ee/v2')
  })
  .strict()

export function parseHiveAccountRelayIntent(value: unknown, now = Date.now()) {
  const parsed = IntentResponse.safeParse(value)
  if (!parsed.success || parsed.data.expiresAt <= now) {
    throw new Error('Invalid or expired Relay connection intent')
  }
  hiveAccountRelayOrigin(parsed.data.cellUrl)
  const publicKey = Uint8Array.from(
    atob(`${parsed.data.runtimePublicKeyB64.replaceAll('-', '+').replaceAll('_', '/')}=`),
    (value) => value.charCodeAt(0)
  )
  if (nacl.scalarMult(new Uint8Array(32).fill(1), publicKey).every((value) => value === 0)) {
    throw new Error('Invalid Relay Runtime public key')
  }
  return parsed.data
}

export type HiveAccountRelayMaterial = {
  outer: {
    clientAdmissionToken: string
    cellUrl: string
    relayHostId: string
    cellId: string
    cellIncarnationId: string
    assignmentId: string
    assignmentEpoch: number
    expiresAt: number
  }
  inner: {
    intentId: string
    ticketId: string
    ticketSecret: Uint8Array
    runtimePublicKeyB64: string
  }
  clientKeyPair: nacl.BoxKeyPair
  clientKind: HiveAccountRelayClientKind
}

export function relayBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function randomUuid(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(16)
  bytes[6] = (bytes[6]! & 15) | 64
  bytes[8] = (bytes[8]! & 63) | 128
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function disposeHiveAccountRelayMaterial(material: HiveAccountRelayMaterial): void {
  material.inner.ticketSecret.fill(0)
  material.clientKeyPair.secretKey.fill(0)
  material.outer.clientAdmissionToken = ''
}

export async function acquireHiveAccountRelayMaterial(options: {
  clientKind: HiveAccountRelayClientKind
  expectedResourceVersion: number
  createIntent: (request: HiveAccountRelayIntentRequest) => Promise<unknown>
  now?: () => number
  randomBytes?: (length: number) => Uint8Array
}): Promise<HiveAccountRelayMaterial> {
  const randomBytes = options.randomBytes ?? nacl.randomBytes
  const clientKeyPair = nacl.box.keyPair.fromSecretKey(randomBytes(32))
  const ticketSecret = randomBytes(32)
  try {
    const request = HiveAccountRelayIntentRequestSchema.parse({
      protocolVersion: 2,
      idempotencyKey: randomUuid(randomBytes),
      expectedResourceVersion: options.expectedResourceVersion,
      clientKind: options.clientKind,
      clientPublicKeyB64: relayBase64Url(clientKeyPair.publicKey),
      ticketSecretSha256: relayBase64Url(sha256(ticketSecret))
    })
    const result = parseHiveAccountRelayIntent(await options.createIntent(request), options.now?.())
    return {
      outer: {
        clientAdmissionToken: result.clientAdmissionToken,
        cellUrl: result.cellUrl,
        relayHostId: result.relayHostId,
        cellId: result.cellId,
        cellIncarnationId: result.cellIncarnationId,
        assignmentId: result.assignmentId,
        assignmentEpoch: result.assignmentEpoch,
        expiresAt: result.expiresAt
      },
      inner: {
        intentId: result.intentId,
        ticketId: result.ticketId,
        ticketSecret,
        runtimePublicKeyB64: `${result.runtimePublicKeyB64.replaceAll('-', '+').replaceAll('_', '/')}=`
      },
      clientKeyPair,
      clientKind: options.clientKind
    }
  } catch (error) {
    clientKeyPair.secretKey.fill(0)
    ticketSecret.fill(0)
    throw error
  }
}
