import { afterEach, describe, expect, it } from 'vitest'

import { APP_DISPLAY_NAME } from '../../../shared/brand'
import { i18n, translate } from './i18n'

describe('renderer product branding', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders standalone upstream brand names as the configured product name', () => {
    expect(translate('test.productNameUpper', 'ORCA')).toBe(APP_DISPLAY_NAME)
    expect(translate('test.productNameTitle', 'Orca Mobile')).toBe(`${APP_DISPLAY_NAME} Mobile`)
  })

  it('preserves compatibility identifiers that contain the upstream name', () => {
    expect(translate('test.configFile', 'orca.yaml')).toBe('orca.yaml')
    expect(translate('test.configFileUpper', 'ORCA.YAML')).toBe('ORCA.YAML')
    expect(translate('test.environmentVariable', 'ORCA_CLOUD_API_URL')).toBe('ORCA_CLOUD_API_URL')
    expect(translate('test.profileType', 'OrcaProfile')).toBe('OrcaProfile')
    expect(translate('test.deepLink', 'orca://workspace')).toBe('orca://workspace')
    expect(translate('test.deepLinkUpper', 'ORCA://workspace')).toBe('ORCA://workspace')
  })

  it('brands catalog values loaded from a non-English locale', async () => {
    await i18n.changeLanguage('zh')

    expect(translate('auto.components.Landing.6ca6ff404e', 'ORCA')).toBe(APP_DISPLAY_NAME)
    expect(translate('auto.components.sidebar.SidebarNav.1b5c41caee', 'Orca Mobile')).toBe(
      `${APP_DISPLAY_NAME} 手机端`
    )
  })
})
