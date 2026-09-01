import { subscribeConnectionRevivalTriggers } from './connection-revival-triggers'
import {
  recoverMobileRelayPairing,
  type MobileRelayPairingRecoveryResult
} from './mobile-relay-pairing-recovery'

type RecoveryMonitorDependencies = {
  recover: () => Promise<MobileRelayPairingRecoveryResult>
  subscribe: (retry: () => void) => () => void
}

const defaultDependencies: RecoveryMonitorDependencies = {
  recover: recoverMobileRelayPairing,
  subscribe: (retry) => subscribeConnectionRevivalTriggers(retry)
}

/**
 * Reconciles a crash journal at startup and whenever the OS reports that a
 * previously unavailable transport may work again.
 */
export function startMobileRelayPairingRecoveryMonitor(
  overrides: Partial<RecoveryMonitorDependencies> = {}
): () => void {
  const dependencies = { ...defaultDependencies, ...overrides }
  let disposed = false
  let running = false
  let retryQueued = false

  const attemptRecovery = () => {
    if (disposed) {
      return
    }
    if (running) {
      retryQueued = true
      return
    }
    running = true
    void runRecovery()
  }

  const runRecovery = async () => {
    try {
      await dependencies.recover()
    } catch {
      // A later app-resume or network-change signal retries the journal.
    } finally {
      running = false
      if (!disposed && retryQueued) {
        retryQueued = false
        attemptRecovery()
      }
    }
  }

  const unsubscribe = dependencies.subscribe(attemptRecovery)
  attemptRecovery()

  return () => {
    disposed = true
    retryQueued = false
    unsubscribe()
  }
}
