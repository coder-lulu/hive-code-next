import type { HiveAccountState } from '../../../../../shared/hive-account'

function accountIdentity(state: HiveAccountState): string {
  return JSON.stringify([
    state.configured,
    state.status,
    state.account?.accountId,
    state.authorityId,
    state.sessionProfile,
    state.errorCode === 'session_expired' ||
      state.errorCode === 'session_rejected' ||
      (state.sessionExpiresAt !== undefined && state.sessionExpiresAt <= Date.now())
  ])
}

// This tracks ownership of UI drafts; task APIs authenticate every operation independently.
export function subscribeHiveUiAccountBoundary(onBoundaryChanged: () => void): () => void {
  let active = true
  let accountEvents = 0
  let identity: string | undefined
  const unsubscribe = window.api.hiveAccount.onStateChanged((account) => {
    if (!active) {
      return
    }
    accountEvents += 1
    const nextIdentity = accountIdentity(account)
    // A short-lived access token or display-name refresh does not change the draft owner.
    if (nextIdentity === identity) {
      return
    }
    identity = nextIdentity
    onBoundaryChanged()
  })
  const readRevision = accountEvents
  void Promise.resolve()
    .then(() => window.api.hiveAccount.getState())
    .then((account) => {
      if (active && accountEvents === readRevision) {
        identity = accountIdentity(account)
      }
    })
    .catch(() => {
      // An unknown initial identity conservatively invalidates drafts on the next event.
    })
  return () => {
    active = false
    unsubscribe()
  }
}
