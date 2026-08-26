import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  clearStoredMobileSession,
  isTerminalMobileSessionError,
  loadStoredMobileSession,
  refreshMobileSession,
  revokeMobileSession,
  type MobileSession
} from './mobile-sms-auth'

type MobileAuthSessionContextValue = {
  readonly hydrated: boolean
  readonly session: MobileSession | null
  readonly signIn: (session: MobileSession) => void
  readonly refresh: () => Promise<MobileSession | null>
  readonly signOut: () => Promise<void>
}

const MobileAuthSessionContext = createContext<MobileAuthSessionContextValue | null>(null)

export function MobileAuthSessionProvider(props: PropsWithChildren) {
  const [session, setSession] = useState<MobileSession | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const sessionRef = useRef<MobileSession | null>(null)

  const applySession = useCallback((next: MobileSession | null) => {
    sessionRef.current = next
    setSession(next)
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const stored = await loadStoredMobileSession()
        if (!active) {
          return
        }
        if (!stored) {
          setHydrated(true)
          return
        }
        if (stored.sessionExpiresAt <= Date.now()) {
          await clearStoredMobileSession()
          if (active) {
            applySession(null)
            setHydrated(true)
          }
          return
        }
        if (stored.expiresAt <= Date.now()) {
          try {
            const refreshed = await refreshMobileSession(stored.refreshToken)
            if (active) {
              applySession(refreshed)
            }
          } catch (failure) {
            if (isTerminalMobileSessionError(failure)) {
              try {
                await clearStoredMobileSession()
              } catch {
                // A storage failure must not leave the app stuck before hydration.
              }
              if (active) {
                applySession(null)
              }
            } else if (active) {
              // A transient outage must not sign the user out. Keep the
              // refresh token and let the next foreground/API retry recover.
              applySession(stored)
            }
          }
        } else {
          applySession(stored)
        }
        if (active) {
          setHydrated(true)
        }
      } catch {
        try {
          await clearStoredMobileSession()
        } catch {
          // Keep hydration fail-safe even when secure storage is unavailable.
        }
        if (active) {
          applySession(null)
          setHydrated(true)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [applySession])

  const signIn = useCallback((next: MobileSession) => applySession(next), [applySession])

  const refresh = useCallback(async () => {
    const current = sessionRef.current
    if (!current) {
      return null
    }
    try {
      const refreshed = await refreshMobileSession(current.refreshToken)
      applySession(refreshed)
      return refreshed
    } catch (failure) {
      if (isTerminalMobileSessionError(failure)) {
        try {
          await clearStoredMobileSession()
        } catch {
          // The in-memory session still must be revoked when storage cleanup fails.
        }
        applySession(null)
      }
      throw failure
    }
  }, [applySession])

  const signOut = useCallback(async () => {
    const current = sessionRef.current
    try {
      if (current) {
        try {
          await revokeMobileSession(current)
        } catch {
          // Local sign-out must complete even when the network is unavailable.
        }
      }
      await clearStoredMobileSession()
    } finally {
      applySession(null)
    }
  }, [applySession])

  const value = useMemo(
    () => ({ hydrated, session, signIn, refresh, signOut }),
    [hydrated, refresh, session, signIn, signOut]
  )

  return (
    <MobileAuthSessionContext.Provider value={value}>
      {props.children}
    </MobileAuthSessionContext.Provider>
  )
}

export function useMobileAuthSession(): MobileAuthSessionContextValue {
  const context = useContext(MobileAuthSessionContext)
  if (!context) {
    throw new Error('useMobileAuthSession must be used within MobileAuthSessionProvider')
  }
  return context
}
