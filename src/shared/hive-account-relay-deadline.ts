import { RemoteRuntimeClientError } from './remote-runtime-client-error'
import { abortSignalReason } from './abort-signal-reason'
import { toHiveAccountRelayClientError } from './hive-account-relay-errors'

const MAX_RELAY_OPERATION_TIMEOUT_MS = 300_000

export function hiveAccountRelayTimeoutError(): RemoteRuntimeClientError {
  return new RemoteRuntimeClientError('runtime_timeout', 'Runtime request timed out')
}

export function createHiveAccountRelayDeadline(timeoutMs: number): number {
  const bounded = Math.max(1, Math.min(timeoutMs, MAX_RELAY_OPERATION_TIMEOUT_MS))
  return Date.now() + (Number.isFinite(bounded) ? bounded : 1)
}

export function remainingHiveAccountRelayDeadlineMs(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

/** Bounds connection acquisition without cancelling a shared Relay connection needed by other callers. */
export function waitForHiveAccountRelayDeadline<T>(
  pending: Promise<T>,
  deadline: number,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(abortSignalReason(signal))
  }
  const remainingMs = remainingHiveAccountRelayDeadlineMs(deadline)
  if (remainingMs <= 0) {
    return Promise.reject(hiveAccountRelayTimeoutError())
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (complete: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      complete()
    }
    const onAbort = (): void => finish(() => reject(abortSignalReason(signal!)))
    const timer = setTimeout(
      () => finish(() => reject(hiveAccountRelayTimeoutError())),
      remainingMs
    )
    signal?.addEventListener('abort', onAbort, { once: true })
    void pending.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    )
  })
}

export async function acquireHiveAccountRelayBeforeTimeout<T>(
  createPending: () => T | Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ value: T; remainingMs: number }> {
  const deadline = createHiveAccountRelayDeadline(timeoutMs)
  let value: T
  try {
    value = await waitForHiveAccountRelayDeadline(
      Promise.resolve(createPending()),
      deadline,
      signal
    )
  } catch (error) {
    signal?.throwIfAborted()
    throw toHiveAccountRelayClientError(error)
  }
  signal?.throwIfAborted()
  const remainingMs = remainingHiveAccountRelayDeadlineMs(deadline)
  if (remainingMs <= 0) {
    throw hiveAccountRelayTimeoutError()
  }
  return { value, remainingMs }
}
