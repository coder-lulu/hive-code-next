import type { RuntimeHostStatusSnapshot } from '../../../../shared/runtime-host-status'
import type { AppState } from '../types'
import type { RuntimeEnvironmentStatus } from './runtime-status-types'
import { ensureBrowserClientHostsForRestoredPages } from '@/runtime/restored-client-hosted-browser-host-attach'
import { replayClientHostedBrowserCloseIntents } from '@/runtime/client-hosted-browser-close-intent-replay'

export function applyRuntimeHostStatusSnapshot(
  snapshot: RuntimeHostStatusSnapshot,
  state: AppState,
  publishEvidence: (entry: RuntimeEnvironmentStatus) => void,
  refreshAlternateRoutes?: () => void
): void {
  const environment = state.runtimeEnvironments.find((entry) => entry.id === snapshot.environmentId)
  if (
    !environment ||
    (environment.pairingRevision ?? environment.createdAt) !== snapshot.pairingRevision
  ) {
    return
  }
  const previous = state.runtimeStatusByEnvironmentId.get(snapshot.environmentId)
  if (previous?.snapshot && previous.snapshot.sequence >= snapshot.sequence) {
    return
  }
  const contactRevoked = Boolean(snapshot.retired || snapshot.verification === 'blocked')
  const shouldRefreshAlternateRoutes = Boolean(
    environment.accountClaim && !contactRevoked && snapshot.verification !== 'verified'
  )
  // A failed local-pairing snapshot says nothing about an account Relay route. Keep the
  // last reachable result in place while the aggregate route probe resolves; that probe
  // will publish null only when every available route is actually unavailable.
  const alternateRouteStatus = shouldRefreshAlternateRoutes ? (previous?.status ?? null) : null
  const entry: RuntimeEnvironmentStatus = {
    snapshot,
    checkedAt: snapshot.checkedAt,
    connectionGeneration: previous?.connectionGeneration,
    hostContactEpoch: previous?.hostContactEpoch,
    status:
      snapshot.verification === 'verified' && !snapshot.retired
        ? snapshot.status
        : alternateRouteStatus,
    remoteControl: alternateRouteStatus
      ? (alternateRouteStatus.remoteControl ?? previous?.remoteControl)
      : snapshot.remoteControl
  }
  if (entry.status && snapshot.verification === 'verified') {
    if (snapshot.remoteControl) {
      entry.status = { ...entry.status, remoteControl: snapshot.remoteControl }
    }
    state.setRuntimeEnvironmentStatus(snapshot.environmentId, entry)
    if (previous?.status == null) {
      void ensureBrowserClientHostsForRestoredPages(state)
      void replayClientHostedBrowserCloseIntents(snapshot.environmentId, {
        clientHostedBrowserCloseIntentsByEnvironment:
          state.clientHostedBrowserCloseIntentsByEnvironment,
        clearClientHostedBrowserCloseIntents: state.clearClientHostedBrowserCloseIntents
      })
    }
  } else {
    // Lost local contact observes no runtime session ending. For a dual-route host this also
    // records the latest local diagnostics while the effective Relay status remains unchanged.
    publishEvidence(entry)
  }
  if (shouldRefreshAlternateRoutes) {
    refreshAlternateRoutes?.()
  }
}
