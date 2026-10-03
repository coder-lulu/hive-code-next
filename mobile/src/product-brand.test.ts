import { describe, expect, it } from 'vitest'

import { APP_DISPLAY_NAME, productNameText } from './product-brand'

describe('mobile product branding', () => {
  it('maps standalone upstream brand names to the configured product', () => {
    expect(productNameText('Orca')).toBe(APP_DISPLAY_NAME)
    expect(productNameText('ORCA Mobile')).toBe(`${APP_DISPLAY_NAME} Mobile`)
    expect(productNameText('Open Orca on your computer')).toBe(
      `Open ${APP_DISPLAY_NAME} on your computer`
    )
  })

  it('preserves compatibility identifiers', () => {
    expect(productNameText('orca.yaml')).toBe('orca.yaml')
    expect(productNameText('ORCA.YAML')).toBe('ORCA.YAML')
    expect(productNameText('ORCA_CLOUD_API_URL')).toBe('ORCA_CLOUD_API_URL')
    expect(productNameText('OrcaProfile')).toBe('OrcaProfile')
    expect(productNameText('orca://pair')).toBe('orca://pair')
  })
})
