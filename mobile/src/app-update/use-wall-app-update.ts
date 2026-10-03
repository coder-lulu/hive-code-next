import { useMobileUpdate } from '../update/use-mobile-update'
import type { MobileUpdateSnapshot } from '../update/mobile-update-state'

export type WallAppUpdate = {
  version: string
  pending: boolean
  message: string | null
  install: () => Promise<MobileUpdateSnapshot>
}

// The compatibility wall ignores dismissal and uses the same verified updater as the app.
export function useWallAppUpdate(): WallAppUpdate | null {
  const { snapshot, install } = useMobileUpdate()
  if (!snapshot.version || !snapshot.artifact) {
    return null
  }
  return {
    version: snapshot.version,
    pending: snapshot.state === 'downloading' || snapshot.state === 'opening-installer',
    message: snapshot.message,
    install
  }
}
