import { useEffect } from 'react'
import { isTransientWebAccountSessionError, type WebAccountSession } from './web-account-session'

export function useWebAccountSessionLifecycle(
  session: Pick<WebAccountSession, 'restore' | 'close'> | undefined,
  closeClients: () => void,
  reloadPage: () => void
): void {
  useEffect(() => {
    if (!session) {
      return
    }
    let active = true
    let checking = false
    const dispose = (): void => {
      active = false
      closeClients()
      session.close()
    }
    const expired = (): void => {
      if (active) {
        dispose()
        reloadPage()
      }
    }
    const check = async (): Promise<void> => {
      if (!active || checking) {
        return
      }
      checking = true
      try {
        if (!(await session.restore())) {
          expired()
        }
      } catch (error) {
        // A failed reachability check is not evidence that the account was revoked.
        if (!isTransientWebAccountSessionError(error)) {
          expired()
        }
      } finally {
        checking = false
      }
    }
    const timer = window.setInterval(() => void check(), 30_000)
    const visible = (): void => {
      if (document.visibilityState === 'visible') {
        void check()
      }
    }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('pagehide', dispose)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('pagehide', dispose)
      dispose()
    }
  }, [session, closeClients, reloadPage])
}
