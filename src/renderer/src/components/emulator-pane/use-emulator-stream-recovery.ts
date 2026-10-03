import { useCallback, useEffect, useRef } from 'react'

const MAX_AUTOMATIC_STREAM_RECOVERY_ATTEMPTS = 2

export function useEmulatorStreamRecovery(onReconnect?: () => void | Promise<void>) {
  const automaticAttemptsRef = useRef(0)
  const pendingRef = useRef(false)
  const onReconnectRef = useRef(onReconnect)

  useEffect(() => {
    onReconnectRef.current = onReconnect
  }, [onReconnect])

  const requestRecovery = useCallback((automatic: boolean) => {
    const reconnect = onReconnectRef.current
    if (!reconnect || pendingRef.current) {
      return
    }
    if (automatic && automaticAttemptsRef.current >= MAX_AUTOMATIC_STREAM_RECOVERY_ATTEMPTS) {
      return
    }
    if (!automatic) {
      automaticAttemptsRef.current = 0
    }
    automaticAttemptsRef.current += 1
    pendingRef.current = true
    try {
      void Promise.resolve(reconnect())
        .catch(() => {})
        .finally(() => {
          pendingRef.current = false
        })
    } catch {
      pendingRef.current = false
    }
  }, [])

  const markRecovered = useCallback(() => {
    automaticAttemptsRef.current = 0
    pendingRef.current = false
  }, [])

  return {
    markRecovered,
    requestAutomaticRecovery: useCallback(() => requestRecovery(true), [requestRecovery]),
    requestManualRecovery: useCallback(() => requestRecovery(false), [requestRecovery])
  }
}
