import { parseRemoteRuntimeJsonText } from '../../../shared/remote-runtime-request-frames'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const REQUIRED_FIELDS = [
  'managedWebSessionId',
  'principalKind',
  'runtimeSessionId',
  'sessionToken',
  'type',
  'v',
  'transcriptHashB64'
] as const

export type CloudManagedE2EEAuth = Readonly<{
  type: 'e2ee_auth'
  v: 2
  transcriptHashB64: string
  principalKind: 'cloud_managed_web_session'
  managedWebSessionId: string
  runtimeSessionId: string
  sessionToken: string
  clientCapabilities?: unknown
}>

export type CloudManagedE2EEAuthResult<TPrincipal> =
  | { kind: 'not_cloud' }
  | { kind: 'bad_auth' }
  | { kind: 'unauthorized' }
  | { kind: 'authenticated'; auth: CloudManagedE2EEAuth; principal: TPrincipal }

export function authenticateCloudManagedE2EE<TPrincipal>(args: {
  plaintext: string
  transcriptHashB64: string
  resolveSession: (auth: CloudManagedE2EEAuth) => TPrincipal | null
}): CloudManagedE2EEAuthResult<TPrincipal> {
  let candidate: unknown
  try {
    candidate = parseRemoteRuntimeJsonText(args.plaintext)
  } catch {
    return { kind: 'not_cloud' }
  }
  if (!isRecord(candidate) || candidate.principalKind !== 'cloud_managed_web_session') {
    return { kind: 'not_cloud' }
  }
  if (
    !isExactCloudAuth(candidate) ||
    candidate.v !== 2 ||
    candidate.transcriptHashB64 !== args.transcriptHashB64
  ) {
    return { kind: 'bad_auth' }
  }
  const auth = candidate as CloudManagedE2EEAuth
  const principal = args.resolveSession(auth)
  return principal ? { kind: 'authenticated', auth, principal } : { kind: 'unauthorized' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExactCloudAuth(value: Record<string, unknown>): boolean {
  const allowedFields =
    value.clientCapabilities === undefined
      ? REQUIRED_FIELDS
      : [...REQUIRED_FIELDS, 'clientCapabilities']
  const keys = Object.keys(value).sort()
  const expected = [...allowedFields].sort()
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    value.type === 'e2ee_auth' &&
    value.principalKind === 'cloud_managed_web_session' &&
    typeof value.managedWebSessionId === 'string' &&
    UUID_PATTERN.test(value.managedWebSessionId) &&
    typeof value.runtimeSessionId === 'string' &&
    UUID_PATTERN.test(value.runtimeSessionId) &&
    typeof value.sessionToken === 'string' &&
    SESSION_TOKEN_PATTERN.test(value.sessionToken)
  )
}
