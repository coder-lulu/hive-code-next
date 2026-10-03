import { describe, expect, it } from 'vitest'
import {
  APP_DISPLAY_NAME,
  applyProductBranding,
  applyProductCliBranding,
  getProductCliDisplayCommand
} from './brand'

describe('applyProductBranding', () => {
  it('rebrands standalone product copy', () => {
    expect(applyProductBranding('Open Orca and restart ORCA.')).toBe(
      `Open ${APP_DISPLAY_NAME} and restart ${APP_DISPLAY_NAME}.`
    )
  })

  it('preserves compatibility identifiers', () => {
    expect(applyProductBranding('orca.yaml ORCA_CLOUD_API_URL orca://pair OrcaProfile')).toBe(
      'orca.yaml ORCA_CLOUD_API_URL orca://pair OrcaProfile'
    )
  })

  it('does not rewrite path segments while branding surrounding copy', () => {
    expect(
      applyProductBranding(
        'Unable to locate the Orca CLI at C:\\Users\\me\\Programs\\Orca\\resources.'
      )
    ).toBe(
      `Unable to locate the ${APP_DISPLAY_NAME} CLI at C:\\Users\\me\\Programs\\Orca\\resources.`
    )
    expect(applyProductBranding('Read Orca metadata from /opt/Orca/config.json.')).toBe(
      `Read ${APP_DISPLAY_NAME} metadata from /opt/Orca/config.json.`
    )
  })
})

describe('applyProductCliBranding', () => {
  it('uses hive for command examples while preserving repository names', () => {
    expect(applyProductCliBranding('orca status\nhivecode runtime claim\n--repo name:orca')).toBe(
      'hive status\nhive runtime claim\n--repo name:orca'
    )
  })

  it('preserves compatibility filenames while branding nearby CLI copy', () => {
    expect(applyProductCliBranding('Run orca status, then inspect orca.yaml.')).toBe(
      'Run hive status, then inspect orca.yaml.'
    )
  })
})

describe('getProductCliDisplayCommand', () => {
  it('normalizes only exact legacy aliases', () => {
    expect(getProductCliDisplayCommand('orca')).toBe('hive')
    expect(getProductCliDisplayCommand('orca-ide')).toBe('hive')
    expect(getProductCliDisplayCommand('orca-dev')).toBe('orca-dev')
    expect(getProductCliDisplayCommand('C:\\Tools\\Orca\\orca.exe')).toBe(
      'C:\\Tools\\Orca\\orca.exe'
    )
  })
})
