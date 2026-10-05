import { z } from 'zod'
import {
  CANONICAL_RUNTIME_RECORD_ID_PATTERN,
  PAIRING_OFFER_VERSION,
  type PairingOffer
} from './pairing'

export const RuntimeAccessEndpointSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('websocket'),
  label: z.string().min(1),
  endpoint: z.string().min(1),
  deviceToken: z.string().min(1),
  publicKeyB64: z.string().min(1)
})

export const PublicRuntimeAccessEndpointSchema = RuntimeAccessEndpointSchema.omit({
  deviceToken: true,
  publicKeyB64: true
})

export type PublicRuntimeAccessEndpoint = z.infer<typeof PublicRuntimeAccessEndpointSchema>

export const RuntimeEnvironmentSourceSchema = z.enum(['manual', 'ephemeral-vm'])
export type RuntimeEnvironmentSource = z.infer<typeof RuntimeEnvironmentSourceSchema>

export const KnownRuntimeEnvironmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  pairingRevision: z.number().finite().optional(),
  pairedDeviceId: z.string().min(1).optional(),
  lastUsedAt: z.number().finite().nullable(),
  runtimeId: z.string().min(1).nullable(),
  // An account Runtime is joined to a local pairing only through this explicit
  // cloud record id. Hostnames and display names are deliberately not identity.
  runtimeRecordId: z.string().regex(CANONICAL_RUNTIME_RECORD_ID_PATTERN).optional(),
  source: RuntimeEnvironmentSourceSchema.optional(),
  connectionDependency: z.literal('ssh-tunnel').optional(),
  endpoints: z.array(RuntimeAccessEndpointSchema).min(1),
  preferredEndpointId: z.string().min(1)
})

export type KnownRuntimeEnvironment = z.infer<typeof KnownRuntimeEnvironmentSchema>

export type RuntimeEnvironmentAccessSource = 'local-pairing' | 'account-claimed'

export type RuntimeEnvironmentAccountClaim = Readonly<{
  runtimeRecordId: string
  resourceVersion: number
  ownershipEpoch: number
  presence: 'ONLINE' | 'DEGRADED' | 'OFFLINE'
  readiness: 'STARTING' | 'READY' | 'DEGRADED' | 'RECOVERING' | 'STOPPED' | 'ERROR' | null
  readinessReasonCode: string | null
  lastHeartbeatAt: number | null
  freeDiskBytes: number | null
  clientAuthMode: 'MTLS' | 'IDENTITY_PROOF' | null
  credentialState:
    | 'ACTIVE'
    | 'EXPIRING'
    | 'ROTATING'
    | 'EXPIRED'
    | 'REVOKED'
    | 'COMPROMISED'
    | 'IDENTITY_PROOF'
    | 'UNAVAILABLE'
  connectionCapabilities: readonly string[]
  cloudConnectable: boolean
  cloudDisplayName: string | null
  cloudDisplayNameVersion: number
  reportedDeviceName?: string | null
}>

export type PublicKnownRuntimeEnvironment = Omit<KnownRuntimeEnvironment, 'endpoints'> & {
  endpoints: PublicRuntimeAccessEndpoint[]
  accessSources?: readonly RuntimeEnvironmentAccessSource[]
  accountClaim?: RuntimeEnvironmentAccountClaim
  localPairedName?: string
}

export function redactRuntimeEnvironment(
  environment: KnownRuntimeEnvironment
): PublicKnownRuntimeEnvironment {
  return {
    ...environment,
    endpoints: environment.endpoints.map(
      ({ deviceToken: _deviceToken, publicKeyB64: _key, ...rest }) => rest
    )
  }
}

export const RuntimeEnvironmentStoreSchema = z.object({
  version: z.literal(1),
  environments: z.array(KnownRuntimeEnvironmentSchema)
})

export type RuntimeEnvironmentStore = z.infer<typeof RuntimeEnvironmentStoreSchema>

export function createEnvironmentFromPairingOffer(args: {
  id: string
  name: string
  now: number
  offer: PairingOffer
  authenticatedRuntimeRecordId?: string
  runtimeId?: string | null
  source?: RuntimeEnvironmentSource
  connectionDependency?: 'ssh-tunnel'
}): KnownRuntimeEnvironment {
  const endpointId = `ws-${args.id}`
  return KnownRuntimeEnvironmentSchema.parse({
    id: args.id,
    name: args.name,
    createdAt: args.now,
    updatedAt: args.now,
    pairingRevision: args.now,
    ...(args.offer.pairedDeviceId ? { pairedDeviceId: args.offer.pairedDeviceId } : {}),
    ...(args.authenticatedRuntimeRecordId
      ? { runtimeRecordId: args.authenticatedRuntimeRecordId }
      : {}),
    lastUsedAt: null,
    runtimeId: args.runtimeId ?? null,
    ...(args.source ? { source: args.source } : {}),
    ...(args.connectionDependency ? { connectionDependency: args.connectionDependency } : {}),
    endpoints: [
      {
        id: endpointId,
        kind: 'websocket',
        label: 'WebSocket',
        endpoint: args.offer.endpoint,
        deviceToken: args.offer.deviceToken,
        publicKeyB64: args.offer.publicKeyB64
      }
    ],
    preferredEndpointId: endpointId
  })
}

export function isEphemeralVmRuntimeEnvironment(
  environment: Pick<PublicKnownRuntimeEnvironment, 'source'>
): boolean {
  return environment.source === 'ephemeral-vm'
}

export function isUserManagedRuntimeEnvironment(
  environment: Pick<PublicKnownRuntimeEnvironment, 'source'>
): boolean {
  return !isEphemeralVmRuntimeEnvironment(environment)
}

export function getPreferredPairingOffer(environment: KnownRuntimeEnvironment): PairingOffer {
  const endpoint =
    environment.endpoints.find((entry) => entry.id === environment.preferredEndpointId) ??
    environment.endpoints[0]
  if (!endpoint) {
    throw new Error(`Environment ${environment.name} has no access endpoints`)
  }
  return {
    v: PAIRING_OFFER_VERSION,
    endpoint: endpoint.endpoint,
    deviceToken: endpoint.deviceToken,
    publicKeyB64: endpoint.publicKeyB64,
    ...(environment.pairedDeviceId ? { pairedDeviceId: environment.pairedDeviceId } : {}),
    ...(environment.runtimeRecordId ? { runtimeRecordId: environment.runtimeRecordId } : {})
  }
}
