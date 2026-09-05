import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  checkProductConfig,
  generateProductConfig,
  normalizeProductManifest,
  renderProductConfigModule,
  validateProductManifest
} from './generate-product-config.mjs'

const validManifest = {
  schemaVersion: 1,
  displayName: 'HiveCode',
  shortName: 'HiveCode',
  slug: 'hivecode',
  branding: {
    logoAsset: 'resources/product-logo.png',
    logoSha256: '46325bf9d05755d2b412f0a2e720cb1944d69abb7f6e3c07b59ed304f4e81950'
  },
  publicLinks: {
    website: null,
    documentation: null,
    support: null,
    community: null,
    social: null,
    desktopDownload: null,
    androidDownload: null,
    iosDownload: null,
    privacyPolicy: null,
    termsOfService: null
  },
  cli: { primary: 'hivecode', aliases: ['orca', 'orca-ide'] },
  schemes: { primary: 'hivecode', aliases: ['orca'] },
  desktop: {
    appId: '',
    executableName: 'HiveCode',
    publisher: '',
    updateProvider: '',
    updateChannel: '',
    updateRepository: '',
    starRepository: ''
  },
  mobile: { bundleId: '', packageId: '' },
  endpoints: {
    artifacts: null,
    cloud: '',
    identityIssuer: null,
    update: '',
    telemetry: null,
    diagnostics: '',
    feedback: null,
    pluginKillList: null,
    pluginMarketplace: null,
    changelog: null,
    nudge: null
  },
  services: {
    api: { baseUrl: 'https://api.example.test' },
    identity: {
      issuer: 'https://identity.example.test/realms/hive',
      clients: { desktop: 'desktop', userWeb: 'user-web', operatorWeb: 'operator-web' }
    },
    oss: { enabled: false, endpoint: null, provider: null },
    update: {
      enabled: false,
      endpoint: null,
      checkEndpoint: null,
      provider: null,
      channel: null,
      checkIntervalHours: 24
    }
  }
}

describe('validateProductManifest', () => {
  it('requires the grouped service contract', () => {
    const manifest = { ...validManifest }
    delete manifest.services
    expect(() => validateProductManifest(manifest)).toThrow(
      'Missing required manifest key: services'
    )
  })

  it('validates the current grouped service contract', () => {
    expect(() => validateProductManifest(validManifest)).not.toThrow()
  })

  it('rejects populated legacy endpoint aliases that drift from services', () => {
    expect(() =>
      validateProductManifest({
        ...validManifest,
        endpoints: { ...validManifest.endpoints, cloud: 'https://stale.example.test' }
      })
    ).toThrow('endpoints.cloud conflicts with services configuration')
  })

  it('accepts empty endpoints and preserves the dual CLI/Scheme compatibility contract', () => {
    expect(normalizeProductManifest(validManifest)).toMatchObject({
      displayName: 'HiveCode',
      cli: { primary: 'hivecode', aliases: ['orca', 'orca-ide'] },
      schemes: { primary: 'hivecode', aliases: ['orca'] },
      endpoints: {
        artifacts: null,
        cloud: null,
        identityIssuer: null,
        update: null,
        telemetry: null,
        diagnostics: null,
        feedback: null,
        pluginKillList: null,
        pluginMarketplace: null,
        changelog: null,
        nudge: null
      }
    })
  })

  it('rejects secret-like keys anywhere in the manifest', () => {
    expect(() => validateProductManifest({ ...validManifest, secretKey: 'do-not-store' })).toThrow(
      'secret-like manifest key'
    )
    expect(() =>
      validateProductManifest({
        ...validManifest,
        endpoints: { ...validManifest.endpoints, apiToken: 'do-not-store' }
      })
    ).toThrow('secret-like manifest key')
  })

  it('rejects duplicate primary and compatibility aliases', () => {
    expect(() =>
      validateProductManifest({
        ...validManifest,
        schemes: { primary: 'hivecode', aliases: ['hivecode'] }
      })
    ).toThrow('must not duplicate the primary value')
  })

  it('rejects updater channels that have no configured product capability', () => {
    expect(() =>
      validateProductManifest({
        ...validManifest,
        desktop: { ...validManifest.desktop, updateChannel: 'hourly' }
      })
    ).toThrow('desktop.updateChannel must be internal, stable, beta, rc, or null')
  })

  it('rejects unknown updater providers', () => {
    expect(() =>
      validateProductManifest({
        ...validManifest,
        desktop: { ...validManifest.desktop, updateProvider: 'generic' }
      })
    ).toThrow('desktop.updateProvider must be github, hivecloud, or null')
  })

  it.each([
    'https://updates.example.test/hive/v1/updates/check/',
    'https://updates.example.test/hive/v1/updates/proxy-check',
    'https://updates.example.test/hive/v1/updates/%63heck'
  ])('requires the canonical HiveCloud update check path: %s', (checkEndpoint) => {
    expect(() =>
      validateProductManifest({
        ...validManifest,
        services: {
          ...validManifest.services,
          update: {
            enabled: true,
            endpoint: 'https://updates.example.test/hive/v1/updates/desktop/',
            checkEndpoint,
            provider: 'hivecloud',
            channel: 'beta',
            checkIntervalHours: 24
          }
        }
      })
    ).toThrow('canonical /hive/v1/updates/check path')
  })

  it.each(['artifacts', 'changelog', 'nudge'])(
    'requires HTTPS for the remote-content %s endpoint',
    (key) => {
      expect(() =>
        validateProductManifest({
          ...validManifest,
          endpoints: {
            ...validManifest.endpoints,
            [key]: 'http://127.0.0.1:49152/content.json'
          }
        })
      ).toThrow(`endpoints.${key} must use HTTPS`)
    }
  )

  it('requires the artifact endpoint to be an origin', () => {
    expect(() =>
      validateProductManifest({
        ...validManifest,
        endpoints: {
          ...validManifest.endpoints,
          artifacts: 'https://artifacts.example.test/api'
        }
      })
    ).toThrow('endpoints.artifacts must be an origin')
  })

  it.each([
    ['publicLinks', 'website'],
    ['cli', 'aliases'],
    ['schemes', 'primary'],
    ['desktop', 'appId'],
    ['desktop', 'publisher'],
    ['desktop', 'updateProvider'],
    ['desktop', 'updateRepository'],
    ['desktop', 'starRepository'],
    ['mobile', 'bundleId'],
    ['endpoints', 'artifacts'],
    ['endpoints', 'update'],
    ['endpoints', 'pluginMarketplace']
  ])('rejects a missing required %s.%s key', (group, key) => {
    const manifest = {
      ...validManifest,
      [group]: { ...validManifest[group] }
    }
    delete manifest[group][key]

    expect(() => validateProductManifest(manifest)).toThrow(`Missing required ${group} key: ${key}`)
  })
})

describe('renderProductConfigModule', () => {
  it('renders deterministic TypeScript without secret-like values', () => {
    const source = renderProductConfigModule(normalizeProductManifest(validManifest))

    expect(source).toContain('export const hivecodeProductConfig =')
    expect(source).toContain("displayName: 'HiveCode'")
    expect(source).toContain('cloud: null')
    expect(source).toContain('export type HiveCodeProductConfig')
    expect(source).not.toContain('secret')
  })
})

describe('generateProductConfig', () => {
  it('writes matching desktop and mobile generated modules', () => {
    const outputRoot = mkdtempSync(path.join(tmpdir(), 'hivecode-product-config-'))
    try {
      const result = generateProductConfig({ manifest: validManifest, outputRoot })
      expect(result.files).toEqual([
        path.join(outputRoot, 'src', 'shared', 'generated', 'product-config.ts'),
        path.join(outputRoot, 'mobile', 'src', 'generated', 'product-config.ts')
      ])

      const desktop = readFileSync(result.files[0], 'utf8')
      const mobile = readFileSync(result.files[1], 'utf8')
      expect(desktop).toBe(mobile)
      expect(desktop).toContain("primary: 'hivecode'")
    } finally {
      rmSync(outputRoot, { recursive: true, force: true })
    }
  })

  it('accepts CRLF-generated modules from a Windows checkout', () => {
    const outputRoot = mkdtempSync(path.join(tmpdir(), 'hivecode-product-config-'))
    try {
      const { files } = generateProductConfig({ manifest: validManifest, outputRoot })
      for (const filePath of files) {
        writeFileSync(filePath, readFileSync(filePath, 'utf8').replace(/\n/g, '\r\n'), 'utf8')
      }

      expect(() => checkProductConfig({ manifest: validManifest, outputRoot })).not.toThrow()
    } finally {
      rmSync(outputRoot, { recursive: true, force: true })
    }
  })
})
