import { z } from 'zod'
import type { HiveAccountRelayMaterial } from '../../../src/shared/hive-account-relay-material'
import {
  CANONICAL_RUNTIME_RECORD_ID_PATTERN,
  PairingOfferSchema as SharedPairingOfferSchema
} from '../../../src/shared/mobile-relay-pairing-offer'
import { NODE_PLATFORM_NAMES } from './mobile-runtime-host-platform'
import { salvagedOptional } from '../../../src/shared/zod-salvage'

const MobileAccessEndpointSchema = z
  .object({ id: z.string().min(1), kind: z.enum(['lan', 'tailscale']), url: z.string().min(1) })
  .strict()
type MobileAccessEndpoint = z.infer<typeof MobileAccessEndpointSchema>

export const RuntimeRecordIdSchema = z.string().regex(CANONICAL_RUNTIME_RECORD_ID_PATTERN)

export const PairingOfferSchema = SharedPairingOfferSchema
export type PairingOffer = z.infer<typeof PairingOfferSchema>

export type RpcRequest = {
  id: string
  deviceToken: string
  method: string
  params?: unknown
}

// Wire validation does not require _meta, and shell-produced native replies have no runtime to name.
export type RpcSuccess = {
  id: string
  ok: true
  result: unknown
  streaming?: true
  _meta?: { runtimeId: string }
}

export type RpcFailure = {
  id: string
  ok: false
  error: { code: string; message: string; data?: unknown }
  _meta?: { runtimeId: string | null }
}

export type RpcResponse = RpcSuccess | RpcFailure

export type ConnectionLogLevel = 'info' | 'success' | 'warn' | 'error'

export type MobileConnectionDiagnosticPath = 'lan' | 'tailscale' | 'relay'

export type ConnectionDiagnosticCode =
  | 'native-render-failed'
  | 'client-session-started'
  | 'app-resumed'
  | 'network-changed'
  | 'suspended-dial'
  | 'connect-timeout'
  | 'handshake-timeout'
  | 'authentication-rejected'
  | 'socket-closed'
  | 'liveness-timeout'
  | 'retry-scheduled'
  | 'relay-dial-failed'
  | 'relay-session-failed'
  | 'relay-connected'
  | 'direct-connected'
  | 'relay-credential-unavailable'
  | 'host-open-failed'
  // OTA web shell lifecycle; diagnostics only, never read as connection failures.
  | 'web-shell-flow'
  | 'web-shell-page'
  | 'web-shell-stalled'
  | 'web-shell-bridge'

export type ConnectionLogEntry = {
  id: string
  ts: number
  level: ConnectionLogLevel
  message: string
  detail?: string
  code?: ConnectionDiagnosticCode
  path?: MobileConnectionDiagnosticPath
  // Carry the relay close code separately so diagnostics need not parse detail.
  relayCloseCode?: number
}

export type ConnectionLogSink = (entry: ConnectionLogEntry) => void

export type ConnectionLogEmitter = (
  level: ConnectionLogLevel,
  message: string,
  detail?: string,
  evidence?: Pick<ConnectionLogEntry, 'code' | 'path'>
) => void

export type ConnectionState =
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'auth-failed'

// Attention nudges probe healthy relays; only a network change justifies replacing the socket.
export type ForegroundNudgeReason = 'focus' | 'app-resume' | 'network-change'

export type HostProfile = {
  id: string
  // Resolved display name; an OS-only desktop report preserves the last adopted name.
  name: string
  // This phone’s rename overrides the desktop’s machine name.
  personalName?: string
  // Last desktop-reported name, retained offline and across restarts.
  lastKnownMachineName?: string
  lastKnownHostPlatform?: NodeJS.Platform
  endpoint: string
  deviceToken: string
  publicKeyB64: string
  lastConnected: number
  runtimeRecordId?: string
  /** A new local pairing incarnation; retained across descriptor and recency updates. */
  pairingRevision?: string
  endpoints?: MobileAccessEndpoint[]
  accountRuntime?: AccountRuntimeRoute
}

export type AccountRuntimeRoute = {
  readonly runtimeRecordId: string
  readonly resourceVersion: number
  readonly createConnection: (signal?: AbortSignal) => Promise<HiveAccountRelayMaterial>
}

export type RuntimeAccessSource = 'manual-pairing' | 'account-claimed'

export type HostCredentialStatus =
  | 'ready'
  | 'temporarily-unavailable'
  | 'missing'
  | 'cloud-offline'
  | 'cloud-unavailable'

export type HostCatalogEntry = Omit<HostProfile, 'deviceToken'> & {
  credentialStatus: HostCredentialStatus
  profile: HostProfile | null
  accessSources?: readonly RuntimeAccessSource[]
  cloudProfile?: HostProfile
  accountPresence?: 'ONLINE' | 'DEGRADED' | 'OFFLINE'
  accountReadiness?: 'STARTING' | 'READY' | 'DEGRADED' | 'RECOVERING' | 'STOPPED'
}

// Salvage unknown/empty platform values independently so persisting them cannot drop the paired host.
// Keep outer optional() so the inferred key remains optional.
const hostNameIdentityFields = {
  personalName: salvagedOptional('personalName', z.string().min(1)).optional(),
  lastKnownMachineName: salvagedOptional('lastKnownMachineName', z.string().min(1)).optional(),
  lastKnownHostPlatform: salvagedOptional(
    'lastKnownHostPlatform',
    z.enum(NODE_PLATFORM_NAMES)
  ).optional()
}

export const HostProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ...hostNameIdentityFields,
  endpoint: z.string().min(1),
  deviceToken: z.string().min(1),
  publicKeyB64: z.string().min(1),
  lastConnected: z.number().finite(),
  runtimeRecordId: RuntimeRecordIdSchema.optional(),
  pairingRevision: z.uuid().optional(),
  endpoints: z.array(MobileAccessEndpointSchema).min(1).max(16).optional()
})

// Never persist deviceToken in AsyncStorage; join it from Keychain when loading the host.
export const StoredHostProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ...hostNameIdentityFields,
  endpoint: z.string().min(1),
  publicKeyB64: z.string().min(1),
  lastConnected: z.number().finite(),
  runtimeRecordId: RuntimeRecordIdSchema.optional(),
  pairingRevision: z.uuid().optional()
})

export type StoredHostProfile = z.infer<typeof StoredHostProfileSchema>
