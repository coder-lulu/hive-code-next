import { useSyncExternalStore } from 'react'

export type HiveMobilePushUnavailableReason =
  | 'not_authenticated'
  | 'notifications_disabled'
  | 'token_unavailable'
  | 'cloud_unavailable'

export type HiveMobilePushAvailability =
  | { status: 'syncing' }
  | { status: 'available' }
  | { status: 'unavailable'; reason: HiveMobilePushUnavailableReason }

let snapshot: HiveMobilePushAvailability = {
  status: 'unavailable',
  reason: 'not_authenticated'
}
const listeners = new Set<() => void>()

export function publishHiveMobilePushAvailability(next: HiveMobilePushAvailability): void {
  if (
    snapshot.status === next.status &&
    (snapshot.status !== 'unavailable' ||
      (next.status === 'unavailable' && snapshot.reason === next.reason))
  ) {
    return
  }
  snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeHiveMobilePushAvailability(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getHiveMobilePushAvailability(): HiveMobilePushAvailability {
  return snapshot
}

export function useHiveMobilePushAvailability(): HiveMobilePushAvailability {
  return useSyncExternalStore(
    subscribeHiveMobilePushAvailability,
    getHiveMobilePushAvailability,
    getHiveMobilePushAvailability
  )
}
