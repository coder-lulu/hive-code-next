import { classifyHiveAccountRelayError } from '../../../src/shared/hive-account-relay-errors'
import type { ConnectionLogSink } from './types'

export function logAccountRuntimeDialFailure(onLog: ConnectionLogSink, generation: number): void {
  onLog({
    id: `account-connect-${generation}`,
    ts: Date.now(),
    level: 'warn',
    message: '账号远程连接失败，正在自动恢复',
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
    message: '账号远程连接中断，正在自动恢复',
    detail: `scope=${scope}; attempt=${attempt}; delayMs=${delayMs}`,
    relayCloseCode: closeCode
  })
}
