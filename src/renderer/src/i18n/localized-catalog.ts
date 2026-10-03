import { i18n } from './i18n'

// Why: search metadata and catalogs call translate() during build. Caching per
// active locale and resource bundle keeps lookups cheap while allowing pack updates.
export function createLocalizedCatalog<T>(builder: () => T): () => T {
  let cachedLocale: string | undefined
  let cachedValue: T | undefined
  let cachedResources: unknown

  return () => {
    const resources: unknown = i18n.getResourceBundle(i18n.language, 'translation')
    if (
      cachedLocale !== i18n.language ||
      cachedResources !== resources ||
      cachedValue === undefined
    ) {
      cachedLocale = i18n.language
      cachedResources = resources
      cachedValue = builder()
    }
    return cachedValue
  }
}
