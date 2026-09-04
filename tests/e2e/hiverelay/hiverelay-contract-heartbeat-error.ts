import {
  type HiveRelayContractVerdict,
  hasExactKeys,
  object
} from './hiverelay-contract-state-rules'

const LEGACY_CODES = new Map<number, string>([
  [400, 'runtime_heartbeat_invalid_request'],
  [401, 'runtime_heartbeat_proof_rejected'],
  [409, 'runtime_heartbeat_conflict'],
  [410, 'runtime_heartbeat_gone'],
  [422, 'runtime_heartbeat_unprocessable'],
  [426, 'UPGRADE_REQUIRED'],
  [503, 'runtime_heartbeat_service_unavailable']
])

const RELAY_CODES = new Map<number, ReadonlySet<string>>([
  [400, new Set(['INVALID_REQUEST'])],
  [401, new Set(['RUNTIME_PROOF_REJECTED'])],
  [409, new Set(['REPLAY_DETECTED', 'COMMAND_REPLAY_CONFLICT', 'SEQUENCE_GAP'])],
  [410, new Set(['STALE_BINDING'])],
  [422, new Set(['INVALID_REQUEST'])],
  [426, new Set(['UPGRADE_REQUIRED'])],
  [503, new Set(['RELAY_UNAVAILABLE'])]
])

function hasValidResponseEnvelope(
  response: Record<string, unknown>,
  status: number
): boolean {
  const expectedKeys =
    status === 503 ? ['status', 'contentType', 'body', 'retryAfter'] : ['status', 'contentType', 'body']
  return (
    hasExactKeys(response, expectedKeys) &&
    (status !== 503 ||
      (typeof response.retryAfter === 'number' &&
        Number.isSafeInteger(response.retryAfter) &&
        response.retryAfter >= 1 &&
        response.retryAfter <= 30))
  )
}

function isValidLegacyResponse(response: Record<string, unknown>, status: number): boolean {
  const body = object(response.body)
  const expectedCode = LEGACY_CODES.get(status)
  return (
    response.contentType === 'application/problem+json' &&
    !!body &&
    hasExactKeys(body, ['type', 'title', 'status', 'code', 'traceId']) &&
    body.status === status &&
    body.code === expectedCode &&
    body.type === `urn:hive:problem:${expectedCode}` &&
    typeof body.title === 'string' &&
    body.title.length >= 1 &&
    body.title.length <= 128 &&
    typeof body.traceId === 'string' &&
    body.traceId.length >= 1 &&
    body.traceId.length <= 128
  )
}

function isValidRelayResponse(response: Record<string, unknown>, status: number): boolean {
  const body = object(response.body)
  const allowedCodes = RELAY_CODES.get(status)
  return (
    response.contentType === 'application/json' &&
    !!body &&
    hasExactKeys(body, ['code']) &&
    typeof body.code === 'string' &&
    !!allowedCodes?.has(body.code)
  )
}

export function evaluateHeartbeatError(input: Record<string, unknown>): HiveRelayContractVerdict {
  if (
    !hasExactKeys(input, ['mode', 'responses']) ||
    (input.mode !== 'legacy' && input.mode !== 'relay-v2') ||
    !Array.isArray(input.responses) ||
    input.responses.length === 0
  ) {
    return ['REJECT', 'INVALID_HEARTBEAT_ERROR']
  }

  for (const entry of input.responses) {
    const response = object(entry)
    const status = response?.status
    if (
      !response ||
      typeof status !== 'number' ||
      !Number.isSafeInteger(status) ||
      !LEGACY_CODES.has(status) ||
      !hasValidResponseEnvelope(response, status) ||
      (input.mode === 'legacy'
        ? !isValidLegacyResponse(response, status)
        : !isValidRelayResponse(response, status))
    ) {
      return ['REJECT', 'INVALID_HEARTBEAT_ERROR']
    }
  }

  return ['ACCEPT', 'VALID_HEARTBEAT_ERROR']
}
