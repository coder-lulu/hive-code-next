// Show the consent notice while the current preference is explicitly unresolved.
import { useState } from 'react'
import { useAppStore } from '../store'
import { FirstLaunchBanner } from './FirstLaunchBanner'

export function TelemetryFirstLaunchSurface(): React.JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  // Main's `telemetry:setOptIn` / `telemetry:acknowledgeBanner` handlers
  // intentionally do NOT broadcast `settings:changed`, so the notice
  // must call `fetchSettings()` itself after its IPC writes to keep the
  // renderer store (and PrivacyPane) from rendering stale telemetry
  // state. See PrivacyPane.tsx for the identical pattern.
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const [dismissedThisSession, setDismissedThisSession] = useState(false)

  if (!settings || dismissedThisSession) {
    return null
  }

  const telemetry = settings.telemetry
  if (!telemetry) {
    // Settings must finish loading before a consent choice can be shown.
    return null
  }

  if (telemetry.optedIn !== null) {
    return null
  }

  return (
    <FirstLaunchBanner
      fetchSettings={fetchSettings}
      onResolve={() => setDismissedThisSession(true)}
    />
  )
}
