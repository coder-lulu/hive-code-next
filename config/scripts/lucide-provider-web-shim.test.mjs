import { describe, expect, it } from 'vitest'
import { ensureLucideProviderExport } from './build-mobile-web-app-bundle.mjs'

describe('the Lucide provider web shim', () => {
  it('adds the fallback only when the installed package does not export a provider', () => {
    const missing = 'export const useLucideContext = () => null;\n'
    const present =
      'function LucideProvider({ children }) { return children; }\nexport { LucideProvider };\n'

    expect(ensureLucideProviderExport(missing)).toContain('export const LucideProvider')
    expect(ensureLucideProviderExport(present)).toBe(present)
  })
})
