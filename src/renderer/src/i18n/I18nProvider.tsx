import { useEffect, useRef, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { useAppStore } from '../store'
import { i18n, getIntlLocale, setRendererPluginLanguagePacks, loadRendererUiLanguage } from './i18n'
import { usePluginLanguagePacks, usePluginLanguagePackStore } from '../store/plugin-language-packs'
import { isPluginUiLanguage } from '../../../shared/ui-language'
import { initializeLanguageDetection, useLanguageReadiness } from './language-readiness'

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const uiLanguage = useAppStore((state) => state.settings?.uiLanguage ?? null)
  const packs = usePluginLanguagePacks()
  const packsLoaded = usePluginLanguagePackStore((state) => state.loaded)
  const retryCount = useLanguageReadiness((state) => state.retryCount)
  const systemLocale = useLanguageReadiness((state) =>
    uiLanguage === 'system' ? state.detection?.locale : null
  )
  const generation = useRef(0)
  // The store keeps unchanged packs by reference, so this changes only when the selected pack's content does.
  const activePack = isPluginUiLanguage(uiLanguage)
    ? packs.find((pack) => pack.id === uiLanguage)
    : undefined
  const awaitingPack = isPluginUiLanguage(uiLanguage) && !activePack && !packsLoaded

  useEffect(() => {
    setRendererPluginLanguagePacks(packs)
  }, [packs])

  useEffect(() => {
    if (uiLanguage === null) {
      return
    }
    const request = ++generation.current
    let cancelled = false
    useLanguageReadiness.setState({ loading: true })
    void (async () => {
      const detection = initializeLanguageDetection()
      try {
        if (uiLanguage === 'system') {
          await detection
          if (cancelled || request !== generation.current) {
            return
          }
        }
        const [, locale] = await Promise.all([
          detection,
          loadRendererUiLanguage(awaitingPack ? 'en' : uiLanguage)
        ])
        if (cancelled || request !== generation.current) {
          return
        }
        await i18n.changeLanguage(locale)
        if (!cancelled && request === generation.current) {
          useLanguageReadiness.setState({ ready: true, error: false, loading: awaitingPack })
        }
      } catch {
        await detection
        if (!cancelled && request === generation.current) {
          await i18n.changeLanguage('en')
          if (!cancelled && request === generation.current) {
            useLanguageReadiness.setState({ ready: true, error: true, loading: false })
          }
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uiLanguage, activePack, retryCount, systemLocale, awaitingPack, packsLoaded])

  useEffect(() => {
    const updateLanguage = (): void => {
      document.documentElement.lang = getIntlLocale()
    }
    updateLanguage()
    i18n.on('languageChanged', updateLanguage)
    return () => {
      i18n.off('languageChanged', updateLanguage)
    }
  }, [])

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
