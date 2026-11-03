import { translate } from '../i18n/mobile-i18n'
import { classifyHiveAccountRelayError } from '../../../src/shared/hive-account-relay-errors'
import type { ConnectionLogSink } from './types'

export function logAccountRuntimeDialFailure(onLog: ConnectionLogSink, generation: number): void {
  onLog({
    id: `account-connect-${generation}`,
    ts: Date.now(),
    level: 'warn',
    message: translate(
      'auto.mobile.src.transport.account.runtime.recovery.31b537211c',
      'Account remote connection failed. Recovering automatically.'
    ),
    code: 'relay-dial-failed',
    path: 'relay'
  })
}

export function accountRuntimeRecovery(error: unknown, attempt = 0) {
  const conflict = error && typeof error === 'object' && 'status' in error && error.status === 409
  const recovery = classifyHiveAccountRelayError(
    conflict ? { ...error, retryable: true } : error,
    attempt
  )
  return {
    retryable: recovery.retryable,
    retryDelayMs: Math.max(
      250,
      recovery.retryDelayMs,
      attempt >= 5 ? 90_000 + Math.floor(Math.random() * 10_000) : 0
    )
  }
}

export function logAccountRuntimeRecovery(
  onLog: ConnectionLogSink,
  error: unknown,
  attempt: number,
  delayMs: number,
  scope: 'connection' | 'subscription'
): void {
  const closeCode =
    error &&
    typeof error === 'object' &&
    'closeCode' in error &&
    typeof error.closeCode === 'number'
      ? error.closeCode
      : undefined
  onLog({
    id: `account-recovery-${scope}-${Date.now()}-${attempt}`,
    ts: Date.now(),
    level: 'warn',
    code: 'retry-scheduled',
    path: 'relay',
    message: translate(
      'auto.mobile.src.transport.account.runtime.recovery.a5e35c1823',
      'Account remote connection was interrupted. Recovering automatically.'
    ),
    detail: `scope=${scope}; attempt=${attempt}; delayMs=${delayMs}`,
    relayCloseCode: closeCode
  })
}
