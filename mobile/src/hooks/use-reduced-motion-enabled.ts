import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/** Mirrors the device accessibility preference for app-level motion effects. */
export function useReducedMotionEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((nextEnabled) => {
        if (mounted) {
          setEnabled(nextEnabled)
        }
      })
      .catch(() => undefined)
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return enabled
}
