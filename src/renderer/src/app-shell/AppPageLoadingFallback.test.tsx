// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { AppPageLoadingFallback } from './AppPageLoadingFallback'

describe('AppPageLoadingFallback', () => {
  it('announces a branded loading state while a lazy page resolves', () => {
    const markup = renderToStaticMarkup(<AppPageLoadingFallback />)

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain(APP_DISPLAY_NAME)
    expect(markup).toContain('animate-spin')
  })
})
