import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import { type ColorSchemeName, useColorScheme } from 'react-native'
import { mobileThemes, type MobileTheme, type MobileThemeScheme } from './mobile-theme'
import {
  loadMobileThemePreference,
  saveMobileThemePreference,
  type MobileThemePreference
} from './mobile-theme-preference'

export type { MobileThemePreference } from './mobile-theme-preference'

const MobileThemeContext = createContext<MobileTheme | null>(null)
const MobileThemePreferenceContext = createContext<{
  readonly preference: MobileThemePreference
  readonly hydrated: boolean
  readonly setPreference: (preference: MobileThemePreference) => Promise<boolean>
} | null>(null)

export function resolveMobileThemeScheme(
  preference: MobileThemePreference,
  systemScheme: ColorSchemeName
): MobileThemeScheme {
  if (preference !== 'system') {
    return preference
  }
  return systemScheme === 'dark' ? 'dark' : 'light'
}

export function MobileThemeProvider(
  props: PropsWithChildren<{
    preference?: MobileThemePreference
    systemSchemeOverride?: MobileThemeScheme
  }>
) {
  const detectedSystemScheme = useColorScheme()
  const [storedPreference, setStoredPreference] = useState<MobileThemePreference>('system')
  const [hydrated, setHydrated] = useState(props.preference !== undefined)
  const preference = props.preference ?? storedPreference

  useEffect(() => {
    if (props.preference !== undefined) {
      setHydrated(true)
      return
    }
    let active = true
    void loadMobileThemePreference(AsyncStorage).then((loadedPreference) => {
      if (active) {
        setStoredPreference(loadedPreference)
        setHydrated(true)
      }
    })
    return () => {
      active = false
    }
  }, [props.preference])

  const setPreference = useCallback(
    async (nextPreference: MobileThemePreference) => {
      if (props.preference !== undefined) {
        return false
      }
      setStoredPreference(nextPreference)
      return saveMobileThemePreference(AsyncStorage, nextPreference)
    },
    [props.preference]
  )

  const scheme = resolveMobileThemeScheme(
    preference,
    props.systemSchemeOverride ?? detectedSystemScheme
  )
  const theme = mobileThemes[scheme]
  const preferenceValue = useMemo(
    () => ({ preference, hydrated, setPreference }),
    [hydrated, preference, setPreference]
  )

  return (
    <MobileThemePreferenceContext.Provider value={preferenceValue}>
      <MobileThemeContext.Provider value={theme}>{props.children}</MobileThemeContext.Provider>
    </MobileThemePreferenceContext.Provider>
  )
}

export function useMobileTheme(): MobileTheme {
  const theme = useContext(MobileThemeContext)
  if (!theme) {
    throw new Error('useMobileTheme must be used within MobileThemeProvider')
  }
  return theme
}

export function useMobileThemePreference() {
  const context = useContext(MobileThemePreferenceContext)
  if (!context) {
    throw new Error('useMobileThemePreference must be used within MobileThemeProvider')
  }
  return context
}

export function useMobileThemeStyles<T>(factory: (theme: MobileTheme) => T): T {
  const theme = useMobileTheme()
  return useMemo(() => factory(theme), [factory, theme])
}
