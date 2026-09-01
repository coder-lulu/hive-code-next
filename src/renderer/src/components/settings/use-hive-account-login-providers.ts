import { useCallback, useEffect, useState } from 'react'
import type { HiveAccountLoginProvider } from '../../../../shared/hive-account'

export function useHiveAccountLoginProviders(open: boolean): {
  providers: HiveAccountLoginProvider[]
  clearProviders: () => void
} {
  const [providers, setProviders] = useState<HiveAccountLoginProvider[]>([])

  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    void window.api.hiveAccount
      .getLoginCapabilities()
      .then((capabilities) => {
        if (active) {
          setProviders(capabilities.providers)
        }
      })
      .catch(() => {
        if (active) {
          setProviders([])
        }
      })
    return () => {
      active = false
    }
  }, [open])

  return {
    providers,
    clearProviders: useCallback(() => setProviders([]), [])
  }
}
