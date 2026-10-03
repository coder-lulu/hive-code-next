import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import {
  checkMobileUpdate,
  downloadAndInstallAndroidUpdate,
  getMobileUpdateSnapshot,
  subscribeMobileUpdate,
  dismissMobileUpdatePrompt,
  showMobileUpdatePrompt,
  resumeMobileUpdate
} from './mobile-update-service'

export function useMobileUpdate(autoStart = false) {
  const snapshot = useSyncExternalStore(
    subscribeMobileUpdate,
    getMobileUpdateSnapshot,
    getMobileUpdateSnapshot
  )
  const checkNow = useCallback(() => {
    showMobileUpdatePrompt()
    return checkMobileUpdate({ force: true })
  }, [])
  const install = useCallback(() => downloadAndInstallAndroidUpdate(), [])

  useEffect(() => {
    if (!autoStart) {
      return
    }
    void checkMobileUpdate({ force: true })
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void resumeMobileUpdate()
      }
    })
    return () => subscription.remove()
  }, [autoStart])

  return { snapshot, checkNow, install, dismiss: dismissMobileUpdatePrompt }
}
