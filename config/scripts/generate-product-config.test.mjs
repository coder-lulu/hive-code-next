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
  cli: { primary: 'hivecode', aliases: ['orca', 'orca-ide'] },
  schemes: { primary: 'hivecode', aliases: ['orca'] },
  desktop: {
    appId: '',
    executableName: 'HiveCode',
    publisher: '',
    updateChannel: '',
    updateRepository: '',
    starRepository: ''
  },
  mobile: { bundleId: '', packageId: '' },
  endpoints: {
    artifacts: null,
    cloud: '',
    relay: null,
    update: '',
    telemetry: null,
    diagnostics: '',
    feedback: null,
    pluginKillList: null,
    pluginMarketplace: null,
    changelog: null,
    nudge: null
  }
}

describe('validateProductManifest', () => {
  it('accepts empty endpoints and preserves the dual CLI/Scheme compatibility contract', () => {
    expect(normalizeProductManifest(validManifest)).toMatchObject({
      displayName: 'HiveCode',
      cli: { primary: 'hivecode', aliases: ['orca', 'orca-ide'] },
      schemes: { primary: 'hivecode', aliases: ['orca'] },
      endpoints: {
        artifacts: null,
        cloud: null,
        relay: null,
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
    ).toThrow('desktop.updateChannel must be stable, rc, or null')
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
    ['cli', 'aliases'],
    ['schemes', 'primary'],
    ['desktop', 'appId'],
    ['desktop', 'publisher'],
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
