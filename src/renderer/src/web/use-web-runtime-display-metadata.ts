import { useEffect, useMemo, useState } from 'react'
import type { WebAccountBootstrap } from './account-runtime-relay/WebAccountConnect'
import { useWebAccountSessionLifecycle } from './account-runtime-relay/use-web-account-session-lifecycle'
import type { CloudLaunchBootstrap } from './cloud-launch-bootstrap'
import {
  captureWebRuntimeDisplayOwner,
  clearWebRuntimeDisplayProjection,
  isCurrentWebRuntimeDisplayOwner,
  WebRuntimeDisplayMetadataError
} from './preload-api/web-runtime-session'
import {
  metadataRetryAfterMs,
  refreshWebRuntimeDisplayMetadata
} from './web-runtime-display-metadata-sync'

type SyncState = 'synced' | 'unverifiable' | 'expired'

export function useWebRuntimeDisplayMetadata(
  account: WebAccountBootstrap | null,
  cloud: CloudLaunchBootstrap | null,
  closeClients: () => void,
  reloadPage: () => void
): SyncState {
  const [state, setState] = useState<SyncState>('synced')
  const lifecycle = useMemo(() => {
    const owner = captureWebRuntimeDisplayOwner()
    if (!owner || (!account && !cloud)) {
      return undefined
    }
    return {
      read: async (signal: AbortSignal) => {
        await refreshWebRuntimeDisplayMetadata(owner, signal)
        if (!signal.aborted && isCurrentWebRuntimeDisplayOwner(owner)) {
          setState('synced')
        }
      },
      unverifiable: (error: unknown) => {
        if (isCurrentWebRuntimeDisplayOwner(owner)) {
          setState('unverifiable')
        }
        return metadataRetryAfterMs(error)
      },
      expired: () => {
        clearWebRuntimeDisplayProjection(owner)
      },
      terminal: () => {
        if (isCurrentWebRuntimeDisplayOwner(owner)) {
          clearWebRuntimeDisplayProjection(owner)
          setState('expired')
        }
      }
    }
  }, [account, cloud])
  useWebAccountSessionLifecycle(
    account?.session,
    closeClients,
    reloadPage,
    account ? lifecycle : undefined
  )

  useEffect(() => {
    if (!cloud || !lifecycle) {
      return
    }
    let active = true
    let reading = false
    let retryAt = 0
    const controller = new AbortController()
    const read = async (): Promise<void> => {
      if (!active || reading || document.visibilityState !== 'visible' || Date.now() < retryAt) {
        return
      }
      if (Date.parse(cloud.expiresAt) <= Date.now()) {
        lifecycle.terminal()
        return
      }
      reading = true
      try {
        await lifecycle.read(controller.signal)
      } catch (error) {
        if (active) {
          if (
            error instanceof WebRuntimeDisplayMetadataError &&
            error.code === 'runtime_display_metadata_binding_invalid'
          ) {
            lifecycle.terminal()
          } else {
            retryAt = Date.now() + (lifecycle.unverifiable(error) ?? 0)
          }
        }
      } finally {
        reading = false
      }
    }
    const visible = (): void => {
      if (document.visibilityState === 'visible') {
        void read()
      }
    }
    const hide = (): void => {
      active = false
      controller.abort()
    }
    const timer = window.setInterval(() => void read(), 30_000)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('pagehide', hide)
    return () => {
      hide()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('pagehide', hide)
    }
  }, [cloud, lifecycle])
  return state
}
