import nacl from 'tweetnacl'
import { z } from 'zod'
import { isCanonicalHiveRelayOrigin } from './hiverelay-contract-origin'
import { fromBase64Url, parseStrictJson } from './hiverelay-test-wire'

const OpaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const UuidV4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const Base64Url16 = z.string().regex(/^[A-Za-z0-9_-]{22}$/)
const Base64Url32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const RelayHostId = z.string().regex(/^[A-Za-z0-9_-]{16}$/)
const Epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const VerifierContextSchema = z
  .object({
    issuer: z.string().min(1),
    acceptedVerifierKids: z
      .array(z.string().min(1))
      .min(1)
      .refine((kids) => new Set(kids).size === kids.length),
    privateOriginsByCellId: z.record(z.string(), z.string().min(1))
  })
  .strict()

const StandardClaims = {
  iss: z.string().min(1),
  sub: OpaqueId,
  jti: UuidV4,
  iat: Epoch,
  nbf: Epoch,
  exp: Epoch
}
const BindingClaims = {
  cellId: OpaqueId,
  cellIncarnationId: UuidV4,
  assignmentId: UuidV4,
  relayHostId: RelayHostId,
  runtimeTupleHash: Base64Url32,
  authorityGeneration: Epoch,
  fencingEpoch: Epoch,
  leaseEpoch: Epoch,
  assignmentEpoch: Epoch
}

const TOKEN_PROFILES = {
  relayToken: {
    typ: 'relay-assignment+jwt',
    aud: 'hive-relay-director',
    schema: z
      .object({
        ...StandardClaims,
        aud: z.literal('hive-relay-director'),
        scope: z.literal('relay:assign'),
        runtimeTupleHash: Base64Url32
      })
      .strict()
  },
  controlLease: {
    typ: 'relay-control+jwt',
    aud: 'hive-relay-cell',
    schema: z
      .object({
        ...StandardClaims,
        ...BindingClaims,
        aud: z.literal('hive-relay-cell'),
        scope: z.literal('relay:control'),
        hostKeyHash: Base64Url32,
        controlGeneration: Epoch
      })
      .strict()
  },
  clientAdmissionToken: {
    typ: 'relay-client-admission+jwt',
    aud: 'hive-relay-cell',
    schema: z
      .object({
        ...StandardClaims,
        ...BindingClaims,
        aud: z.literal('hive-relay-cell'),
        scope: z.literal('relay:connect'),
        intentId: UuidV4,
        clientKeyHash: Base64Url32
      })
      .strict()
  },
  cellOpsToken: {
    typ: 'relay-cell-ops+jwt',
    aud: 'hive-relay-cell-ops',
    schema: z
      .object({
        ...StandardClaims,
        sub: z.literal('hive-cloud-relay-ops'),
        aud: z.literal('hive-relay-cell-ops'),
        scope: z.enum(['relay:cell:status', 'relay:cell:lifecycle', 'relay:cell:fence']),
        method: z.enum(['GET', 'POST']),
        path: z.enum(['/internal/status', '/internal/v1/lifecycle', '/internal/v1/fences']),
        privateOrigin: z.string().min(1),
        cellId: OpaqueId,
        nonce: Base64Url16
      })
      .strict()
  }
} as const

type TokenType = keyof typeof TOKEN_PROFILES
type TestKey = {
  kid: string
  purpose: string
  alg: string
  curve: string
  publicKeyB64Url: string
}
export type JwsVerifierContext = z.infer<typeof VerifierContextSchema>

const CELL_OPS_BINDINGS = {
  'relay:cell:status': { method: 'GET', path: '/internal/status' },
  'relay:cell:lifecycle': { method: 'POST', path: '/internal/v1/lifecycle' },
  'relay:cell:fence': { method: 'POST', path: '/internal/v1/fences' }
} as const

function decodePart(part: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) {
    return null
  }
  const bytes = Buffer.from(part, 'base64url')
  if (bytes.toString('base64url') !== part) {
    return null
  }
  try {
    return parseStrictJson(bytes.toString('utf8'), z.record(z.string(), z.unknown()))
  } catch {
    return null
  }
}

export function validateFixtureJws(args: {
  tokenType: string
  compactJws: string
  validationTime: number
  clockSkewSeconds: number
  lifetimeSeconds: number
  keys: readonly TestKey[]
  verifierContext: unknown
}): string {
  const profile = TOKEN_PROFILES[args.tokenType as TokenType]
  if (!profile) {
    return 'INVALID_TOKEN_TYPE'
  }
  const parts = args.compactJws.split('.')
  if (parts.length !== 3) {
    return 'INVALID_JWS'
  }
  const [headerPart, claimsPart, signaturePart] = parts as [string, string, string]
  const header = decodePart(headerPart)
  const claims = decodePart(claimsPart)
  const signature = fromBase64Url(signaturePart, 64)
  if (!header || !claims || !signature) {
    return 'INVALID_JWS'
  }
  const context = VerifierContextSchema.safeParse(args.verifierContext)
  if (
    !context.success ||
    Object.values(context.data.privateOriginsByCellId).some(
      (origin) => !isCanonicalHiveRelayOrigin(origin)
    )
  ) {
    return 'INVALID_JWS'
  }
  if (header.alg !== 'EdDSA') {
    return 'INVALID_ALG'
  }
  if (header.typ !== profile.typ) {
    return 'INVALID_TYP'
  }
  if (typeof header.kid !== 'string' || !context.data.acceptedVerifierKids.includes(header.kid)) {
    return 'UNKNOWN_KID'
  }
  const key = args.keys.find((candidate) => candidate.kid === header.kid)
  if (!key) {
    return 'UNKNOWN_KID'
  }
  if (key.purpose !== 'cloud-relay-ed25519' || key.alg !== 'EdDSA' || key.curve !== 'Ed25519') {
    return 'INVALID_KEY_PURPOSE'
  }
  const publicKey = fromBase64Url(key.publicKeyB64Url, 32)
  const signingInput = Buffer.from(`${headerPart}.${claimsPart}`)
  if (!publicKey || !nacl.sign.detached.verify(signingInput, signature, publicKey)) {
    return 'INVALID_SIGNATURE'
  }
  if (claims.iss !== context.data.issuer) {
    return 'WRONG_ISSUER'
  }
  if (claims.aud !== profile.aud) {
    return 'WRONG_AUDIENCE'
  }
  if (!profile.schema.safeParse(claims).success) {
    return 'INVALID_TOKEN_CLAIMS'
  }
  if (
    typeof claims.iat !== 'number' ||
    typeof claims.nbf !== 'number' ||
    claims.nbf !== claims.iat
  ) {
    return 'INVALID_NBF'
  }
  if (
    typeof claims.exp !== 'number' ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > args.lifetimeSeconds
  ) {
    return 'INVALID_TOKEN_LIFETIME'
  }
  if (claims.iat > args.validationTime + args.clockSkewSeconds) {
    return 'TOKEN_NOT_YET_VALID'
  }
  if (claims.exp <= args.validationTime) {
    return 'TOKEN_EXPIRED'
  }
  if (args.tokenType === 'cellOpsToken') {
    const scope = claims.scope as keyof typeof CELL_OPS_BINDINGS
    const binding = CELL_OPS_BINDINGS[scope]
    if (!binding || claims.method !== binding.method || claims.path !== binding.path) {
      return 'WRONG_OPERATION_BINDING'
    }
    if (
      typeof claims.cellId !== 'string' ||
      typeof claims.privateOrigin !== 'string' ||
      !isCanonicalHiveRelayOrigin(claims.privateOrigin) ||
      context.data.privateOriginsByCellId[claims.cellId] !== claims.privateOrigin
    ) {
      return 'WRONG_BINDING'
    }
  }
  const headerKeys = Object.keys(header).sort().join(',')
  return headerKeys === 'alg,kid,typ' ? 'VALID_JWS' : 'INVALID_JWS'
}
