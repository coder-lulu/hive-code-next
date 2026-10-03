import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import {
  ClaimPendingPresenceError,
  FatalPresenceError,
  isRetryablePresenceError
} from './hive-runtime-cloud-presence-support'

type ActivationFailureHandlers = Readonly<{
  stale: boolean
  claimPending: () => void
  fence: () => void
  retry: () => void
}>

export function handleHiveRuntimeCloudActivationFailure(
  error: unknown,
  handlers: ActivationFailureHandlers
): void {
  if (handlers.stale) {
    return
  }
  if (error instanceof ClaimPendingPresenceError) {
    handlers.claimPending()
  } else if (error instanceof FatalPresenceError || !isRetryablePresenceError(error)) {
    handlers.fence()
  } else {
    handlers.retry()
  }
}

type HeartbeatFailureHandlers = Readonly<{
  stale: boolean
  tupleChanged: () => void
  fence: () => void
  retry: () => void
}>

export function handleHiveRuntimeCloudHeartbeatFailure(
  error: unknown,
  handlers: HeartbeatFailureHandlers
): void {
  if (handlers.stale) {
    return
  }
  if (
    error instanceof HiveRuntimeCloudRequestError &&
    (error.status === 409 || error.status === 410)
  ) {
    handlers.tupleChanged()
  } else if (error instanceof FatalPresenceError || !isRetryablePresenceError(error)) {
    handlers.fence()
  } else {
    handlers.retry()
  }
}
