import { z } from 'zod'
import type { HiveAccountRelayMaterial } from '../../../src/shared/hive-account-relay-material'
import {
  CANONICAL_RUNTIME_RECORD_ID_PATTERN,
  PairingOfferSchema as SharedPairingOfferSchema
} from '../../../src/shared/mobile-relay-pairing-offer'
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

export type RpcSuccess = {
  id: string
  ok: true
  result: unknown
  streaming?: true
  _meta: { runtimeId: string }
}

export type RpcFailure = {
  id: string
  ok: false
  error: { code: string; message: string; data?: unknown }
  _meta: { runtimeId: string }
}

export type RpcResponse = RpcSuccess | RpcFailure

export type ConnectionLogLevel = 'info' | 'success' | 'warn' | 'error'

export type MobileConnectionDiagnosticPath = 'lan' | 'tailscale' | 'relay'

export type ConnectionDiagnosticCode =
  | 'client-session-started'
  | 'app-resumed'
  | 'network-changed'
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

export type ConnectionLogEntry = {
  id: string
  ts: number
  level: ConnectionLogLevel
  // Short human-readable phase label, e.g. 'Opening WebSocket'.
  message: string
  // Optional second line for endpoint/error/elapsed detail.
  detail?: string
  code?: ConnectionDiagnosticCode
  path?: MobileConnectionDiagnosticPath
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

// Why: a user-attention nudge must not tear down a healthy relay (probe it); only a
// network-change nudge marks the socket suspect enough to replace it.
export type ForegroundNudgeReason = 'focus' | 'app-resume' | 'network-change'

export type HostProfile = {
  id: string
  name: string
  endpoint: string
  deviceToken: string
  publicKeyB64: string
  lastConnected: number
  runtimeRecordId?: string
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

export const HostProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  deviceToken: z.string().min(1),
  publicKeyB64: z.string().min(1),
  lastConnected: z.number().finite(),
  runtimeRecordId: RuntimeRecordIdSchema.optional(),
  endpoints: z.array(MobileAccessEndpointSchema).min(1).max(16).optional()
})

// Why: persisted host record after the v0.0.3 keychain split. The
// deviceToken is held in iOS Keychain via expo-secure-store and joined
// in at load time; it must NOT appear in AsyncStorage anymore.
export const StoredHostProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  publicKeyB64: z.string().min(1),
  lastConnected: z.number().finite(),
  runtimeRecordId: RuntimeRecordIdSchema.optional()
})

export type StoredHostProfile = z.infer<typeof StoredHostProfileSchema>
