import { afterEach, describe, expect, it } from 'vitest'

import { APP_DISPLAY_NAME, PRIMARY_CLI_COMMAND } from '../../../shared/brand'
import { i18n, translate } from './i18n'

describe('renderer product branding', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders standalone upstream brand names as the configured product name', () => {
    expect(translate('test.productNameUpper', 'ORCA')).toBe(APP_DISPLAY_NAME)
    expect(translate('test.productNameTitle', 'Orca Mobile')).toBe(`${APP_DISPLAY_NAME} Mobile`)
  })

  it('brands canonical plural defaults before interpolating host data', () => {
    expect(
      translate('test.canonicalPlural', '{{count}} Orca workspaces on {{host}}', {
        count: 1,
        defaultValue_one: '{{count}} Orca workspace on {{host}}',
        host: '/Orca/user-owned/orca'
      })
    ).toBe(`1 ${APP_DISPLAY_NAME} workspace on /Orca/user-owned/orca`)
  })

  it('brands a current static default while preserving the signed-in user value', () => {
    expect(
      translate('test.currentAccountCopy', 'An earlier Orca version may have copied {{login}}.', {
        login: 'Orca user'
      })
    ).toBe(`An earlier ${APP_DISPLAY_NAME} version may have copied Orca user.`)
  })

  it('preserves compatibility identifiers that contain the upstream name', () => {
    expect(translate('test.configFile', 'orca.yaml')).toBe('orca.yaml')
    expect(translate('test.configFileUpper', 'ORCA.YAML')).toBe('ORCA.YAML')
    expect(translate('test.environmentVariable', 'ORCA_CLOUD_API_URL')).toBe('ORCA_CLOUD_API_URL')
    expect(translate('test.profileType', 'OrcaProfile')).toBe('OrcaProfile')
    expect(translate('test.deepLink', 'orca://workspace')).toBe('orca://workspace')
    expect(translate('test.deepLinkUpper', 'ORCA://workspace')).toBe('ORCA://workspace')
  })

  it('uses the primary command in translated CLI examples', () => {
    expect(translate('test.cliCommand', 'Run `orca status` and retry.')).toBe(
      `Run \`${PRIMARY_CLI_COMMAND} status\` and retry.`
    )
  })

  it('does not rewrite values interpolated into branded static copy', () => {
    expect(
      translate('test.dynamicProductData', 'Project "{{name}}" is ready at {{url}}.', {
        name: 'orca status',
        url: 'https://orca.dev'
      })
    ).toBe('Project "orca status" is ready at https://orca.dev.')
  })

  it('brands catalog values loaded from a non-English locale', async () => {
    await i18n.changeLanguage('zh')

    expect(translate('auto.components.Landing.6ca6ff404e', 'ORCA')).toBe(APP_DISPLAY_NAME)
    expect(
      translate('auto.components.settings.AppearancePane.9da1020447', 'Show Orca Mobile Button')
    ).toBe(`显示 ${APP_DISPLAY_NAME} 手机端按钮`)
  })
})
