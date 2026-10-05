import { useEffect } from 'react'
import { isTransientWebAccountSessionError, type WebAccountSession } from './web-account-session'

export type WebAccountMetadataLifecycle = Readonly<{
  read: (signal: AbortSignal) => Promise<void>
  unverifiable: (error: unknown) => number | undefined
  expired: () => void
}>

export function useWebAccountSessionLifecycle(
  session: Pick<WebAccountSession, 'restore' | 'close'> | undefined,
  closeClients: () => void,
  reloadPage: () => void,
  metadata?: WebAccountMetadataLifecycle
): void {
  useEffect(() => {
    if (!session) {
      return
    }
    let active = true
    let checking = false
    let retryAt = 0
    const controller = new AbortController()
    const dispose = (): void => {
      active = false
      controller.abort()
      metadata?.expired()
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
      if (!active || checking || document.visibilityState !== 'visible' || Date.now() < retryAt) {
        return
      }
      checking = true
      try {
        if (!(await session.restore(controller.signal))) {
          expired()
        } else if (active && metadata) {
          try {
            await metadata.read(controller.signal)
          } catch (error) {
            if (active) {
              if (
                error instanceof Error &&
                'code' in error &&
                error.code === 'runtime_display_metadata_binding_invalid'
              ) {
                expired()
              } else {
                retryAt = Date.now() + (metadata.unverifiable(error) ?? 0)
              }
            }
          }
        }
      } catch (error) {
        // A failed reachability check is not evidence that the account was revoked.
        if (!isTransientWebAccountSessionError(error)) {
          expired()
        } else if (active && metadata) {
          retryAt = Date.now() + (metadata.unverifiable(error) ?? 0)
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
  }, [session, closeClients, reloadPage, metadata])
}
