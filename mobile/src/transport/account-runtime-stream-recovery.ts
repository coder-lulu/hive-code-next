import type { HiveAccountRelayPool } from '../../../src/shared/hive-account-relay-pool'
import { attachAccountRuntimeStream, type AccountRuntimeStream } from './account-runtime-rpc-stream'
import { accountRuntimeRecovery, logAccountRuntimeRecovery } from './account-runtime-recovery'
import { hostStatusProbe } from './host-status-probe-operations'
import type { ConnectionLogSink } from './types'
import {
  RpcSessionLivenessWatchdog,
  LIVENESS_PROBE_TIMEOUT_MS
} from './rpc-session-liveness-watchdog'

export function detachAccountRuntimeStream(stream: AccountRuntimeStream): void {
  stream.generation = 0
  if (stream.retryTimer) {
    clearTimeout(stream.retryTimer)
  }
  stream.retryTimer = null
  stream.health?.stop(stream)
  stream.health = undefined
  const physical = stream.physical
  stream.physical = null
  physical?.close()
}

export function recoverAccountRuntimeStream(
  stream: AccountRuntimeStream,
  pool: HiveAccountRelayPool,
  lifecycle: {
    generation: number
    current(): boolean
    onInbound(): void
    onEnded(): void
    reattach(): void
    onRetryAfter(deadline: number): void
    onLog: ConnectionLogSink
  }
): void {
  const generation = lifecycle.generation
  stream.generation = generation
  const current = () => lifecycle.current() && stream.generation === generation
  const onClosed = (error: unknown) => {
    if (!current()) {
      return
    }
    detachAccountRuntimeStream(stream)
    const recovery = accountRuntimeRecovery(error, stream.retryAttempt)
    if (!recovery.retryable) {
      lifecycle.onEnded()
      stream.listener({ type: 'error', message: '会话连接被拒绝，请检查访问权限后重试' })
      return
    }
    stream.retryAttempt++
    if (error && typeof error === 'object' && 'status' in error && error.status === 429) {
      lifecycle.onRetryAfter(Date.now() + recovery.retryDelayMs)
    }
    logAccountRuntimeRecovery(
      lifecycle.onLog,
      error,
      stream.retryAttempt,
      recovery.retryDelayMs,
      'subscription'
    )
    stream.retryTimer = setTimeout(() => {
      stream.retryTimer = null
      if (lifecycle.current()) {
        lifecycle.reattach()
      }
    }, recovery.retryDelayMs)
  }
  const health = new RpcSessionLivenessWatchdog({
    transport: 'relay',
    voluntaryProbeMinIntervalMs: 10_000,
    sendProbe: () => {
      if (!current() || !stream.physical) {
        return false
      }
      // Probe the subscription's own channel; another healthy channel proves nothing about it.
      void hostStatusProbe
        .request(stream.physical, undefined, { timeoutMs: LIVENESS_PROBE_TIMEOUT_MS })
        .then(
          () => {
            if (current()) {
              lifecycle.onInbound()
              health.noteAuthenticatedInbound(stream)
            }
          },
          () => {
            /* The watchdog tolerates missed replies before retiring this channel. */
          }
        )
      return true
    },
    onTimeout: (evidence) =>
      lifecycle.onLog({
        id: `account-liveness-${generation}-${Date.now()}`,
        ts: Date.now(),
        level: 'warn',
        code: 'liveness-timeout',
        path: 'relay',
        message: '账号会话健康检查超时，正在恢复',
        detail: `missedProbes=${evidence.missedProbes}; lastInboundAgeMs=${evidence.lastInboundAgeMs}`
      }),
    terminate: () => onClosed(new Error('Account subscription liveness timeout'))
  })
  stream.health = health
  attachAccountRuntimeStream(stream, pool, {
    current,
    onReady: () => health.start(stream),
    onInbound: () => {
      lifecycle.onInbound()
      stream.retryAttempt = 0
      health.noteAuthenticatedInbound(stream)
    },
    onEnded: () => {
      lifecycle.onEnded()
      detachAccountRuntimeStream(stream)
    },
    onClosed
  })
}
