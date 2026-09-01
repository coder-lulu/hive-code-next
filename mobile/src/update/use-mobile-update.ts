import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import {
  checkMobileUpdate,
  downloadAndInstallAndroidUpdate,
  getMobileUpdateSnapshot,
  subscribeMobileUpdate
} from './mobile-update-service'

export function useMobileUpdate(autoStart = false) {
  const snapshot = useSyncExternalStore(
    subscribeMobileUpdate,
    getMobileUpdateSnapshot,
    getMobileUpdateSnapshot
  )
  const checkNow = useCallback(() => checkMobileUpdate({ force: true }), [])
  const install = useCallback(() => downloadAndInstallAndroidUpdate(), [])

  useEffect(() => {
    if (!autoStart) {
      return
    }
    void checkMobileUpdate()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void checkMobileUpdate()
      }
    })
    return () => subscription.remove()
  }, [autoStart])

  return { snapshot, checkNow, install }
}
