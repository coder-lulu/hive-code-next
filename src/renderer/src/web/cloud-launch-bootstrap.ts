import type { CloudLaunchCredential } from './cloud-launch-fragment'
import {
  parseRuntimeDisplayMetadata,
  type RuntimeDisplayMetadata
} from '../../../shared/runtime-display-metadata'

const CLOUD_LAUNCH_PROTOCOL_VERSION = 'cloud-launch/v1' as const
const CLOUD_LAUNCH_EXCHANGE_PATH = '/_hive/web-launch/exchange'
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const BASE64URL_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/
const RESPONSE_FIELDS = new Set([
  'protocolVersion',
  'managedWebSessionId',
  'runtimeSessionId',
  'websocketUrl',
  'serverPublicKeyB64',
  'sessionToken',
  'expiresAt',
  'runtimeDisplayMetadata'
])

export type CloudLaunchBootstrap = {
  protocolVersion: typeof CLOUD_LAUNCH_PROTOCOL_VERSION
  managedWebSessionId: string
  runtimeSessionId: string
  websocketUrl: string
  serverPublicKeyB64: string
  sessionToken: string
  expiresAt: string
  runtimeDisplayMetadata: RuntimeDisplayMetadata
}

type CloudLaunchFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type CloudLaunchExchangeOptions = {
  fetchImpl?: CloudLaunchFetch
  browserOrigin?: string
}

export async function exchangeCloudLaunchCredential(
  credential: CloudLaunchCredential,
  options: CloudLaunchExchangeOptions = {}
): Promise<CloudLaunchBootstrap> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const browserOrigin = options.browserOrigin ?? globalThis.location?.origin
  if (!browserOrigin) {
    throw new Error('Cloud launch requires a browser origin')
  }

  const response = await fetchImpl(CLOUD_LAUNCH_EXCHANGE_PATH, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ protocolVersion: CLOUD_LAUNCH_PROTOCOL_VERSION, ...credential }),
    cache: 'no-store',
    redirect: 'error',
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  })

  if (response.status !== 201) {
    throw new Error(`Cloud launch exchange failed with status ${response.status}`)
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new Error('Cloud launch exchange returned a non-JSON response')
  }

  return parseCloudLaunchBootstrap(await response.json(), browserOrigin)
}

function parseCloudLaunchBootstrap(value: unknown, browserOrigin: string): CloudLaunchBootstrap {
  if (!isExactResponseObject(value)) {
    throw new Error('Cloud launch exchange returned an invalid response shape')
  }
  if (value.protocolVersion !== CLOUD_LAUNCH_PROTOCOL_VERSION) {
    throw new Error('Cloud launch exchange returned an unsupported protocol version')
  }
  if (
    !isCanonicalUuid(value.managedWebSessionId) ||
    !isCanonicalUuid(value.runtimeSessionId) ||
    !isSecureSameOriginEndpoint(value.websocketUrl, browserOrigin) ||
    typeof value.serverPublicKeyB64 !== 'string' ||
    value.serverPublicKeyB64.length === 0 ||
    typeof value.sessionToken !== 'string' ||
    !BASE64URL_SESSION_TOKEN_PATTERN.test(value.sessionToken) ||
    typeof value.expiresAt !== 'string' ||
    !isIsoInstant(value.expiresAt)
  ) {
    throw new Error('Cloud launch exchange returned invalid bootstrap data')
  }

  return {
    protocolVersion: value.protocolVersion,
    managedWebSessionId: value.managedWebSessionId,
    runtimeSessionId: value.runtimeSessionId,
    websocketUrl: value.websocketUrl,
    serverPublicKeyB64: value.serverPublicKeyB64,
    sessionToken: value.sessionToken,
    expiresAt: value.expiresAt,
    runtimeDisplayMetadata: parseRuntimeDisplayMetadata(value.runtimeDisplayMetadata)
  }
}

function isExactResponseObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value)
  return keys.length === RESPONSE_FIELDS.size && keys.every((key) => RESPONSE_FIELDS.has(key))
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_PATTERN.test(value)
}

function isSecureSameOriginEndpoint(value: unknown, browserOrigin: string): value is string {
  if (typeof value !== 'string') {
    return false
  }

  try {
    const page = new URL(browserOrigin)
    const endpoint = new URL(value)
    return (
      page.protocol === 'https:' &&
      endpoint.protocol === 'wss:' &&
      endpoint.hostname === page.hostname &&
      endpoint.port === '' &&
      (page.port || '443') === '443' &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash
    )
  } catch {
    return false
  }
}

function isIsoInstant(value: string): boolean {
  return ISO_INSTANT_PATTERN.test(value) && Number.isFinite(Date.parse(value))
}
