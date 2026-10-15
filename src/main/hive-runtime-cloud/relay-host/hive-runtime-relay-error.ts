import type { HiveRuntimeRelayError } from '../../../shared/hive-runtime-cloud'
import {
  HiveRuntimeCloudRequestError,
  HiveRuntimeCloudTransportError
} from '../hive-runtime-cloud-http-client'

const CLOUD_REJECTION_CODES = new Set([
  'INVALID_REQUEST',
  'LOW_ORDER_X25519',
  'BINDING_NOT_FOUND',
  'STALE_BINDING',
  'RELAY_HOST_ID_COLLISION',
  'BINDING_REPLAY_CONFLICT',
  'CELL_NOT_FOUND',
  'CELL_ORIGIN_CONFLICT',
  'CELL_OBSERVATION_STALE',
  'CELL_OBSERVATION_REPLAY_CONFLICT',
  'ASSIGNMENT_NOT_FOUND',
  'ASSIGNMENT_AUTHORITY_STALE',
  'ASSIGNMENT_REPLAY_CONFLICT',
  'NO_ELIGIBLE_CELL',
  'CAPACITY_EXCEEDED',
  'RATE_LIMITED',
  'TICKET_NOT_FOUND',
  'TICKET_EXPIRED',
  'TICKET_BINDING_MISMATCH',
  'RUNTIME_PROOF_REJECTED',
  'TICKET_REPLAY_CONFLICT',
  'COMMAND_REPLAY_CONFLICT',
  'TRANSITION_REPLAY_CONFLICT',
  'SEQUENCE_GAP',
  'LOCK_TIMEOUT',
  'DATABASE_UNAVAILABLE',
  'RELAY_UNAVAILABLE',
  'INTERNAL_FAILURE'
])

export function hiveRuntimeRelayError(error: unknown): HiveRuntimeRelayError {
  if (error instanceof HiveRuntimeCloudRequestError) {
    return Object.freeze({
      code:
        error.category !== null && CLOUD_REJECTION_CODES.has(error.category)
          ? error.category
          : 'CLOUD_REQUEST_FAILED',
      httpStatus: error.status
    })
  }
  return Object.freeze({
    code:
      error instanceof HiveRuntimeCloudTransportError
        ? 'CLOUD_UNREACHABLE'
        : 'RELAY_CONNECTION_FAILED',
    httpStatus: null
  })
}
