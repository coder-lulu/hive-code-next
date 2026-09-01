import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  getProductExternalServiceEndpoints,
  getProductStarRepository
} from './product-external-service-endpoints'

describe('product external service endpoints', () => {
  it('keeps every unapproved HiveCode service disabled', () => {
    expect(getProductExternalServiceEndpoints()).toEqual({
      artifacts: null,
      feedback: null,
      pluginKillList: null,
      pluginMarketplace: null,
      changelog: null,
      nudge: null,
      telemetry: null,
      diagnostics: null
    })
  })

  it('uses only explicit product configuration', () => {
    expect(
      getProductExternalServiceEndpoints({
        endpoints: {
          artifacts: 'https://artifacts.example.test',
          feedback: 'https://feedback.example.test',
          pluginKillList: 'https://plugins.example.test/kill-list.json',
          pluginMarketplace: 'https://github.example.test/hive/plugins.git',
          changelog: 'https://updates.example.test/changelog.json',
          nudge: 'https://updates.example.test/nudge.json',
          telemetry: 'https://telemetry.example.test',
          diagnostics: 'https://diagnostics.example.test/token'
        }
      })
    ).toEqual({
      artifacts: 'https://artifacts.example.test',
      feedback: 'https://feedback.example.test',
      pluginKillList: 'https://plugins.example.test/kill-list.json',
      pluginMarketplace: 'https://github.example.test/hive/plugins.git',
      changelog: 'https://updates.example.test/changelog.json',
      nudge: 'https://updates.example.test/nudge.json',
      telemetry: 'https://telemetry.example.test',
      diagnostics: 'https://diagnostics.example.test/token'
    })
  })

  it('does not revive artifacts from legacy endpoints when OSS is disabled', () => {
    expect(
      getProductExternalServiceEndpoints({
        endpoints: {
          artifacts: 'https://artifacts.example.test',
          feedback: null,
          pluginKillList: null,
          pluginMarketplace: null,
          changelog: null,
          nudge: null,
          telemetry: null,
          diagnostics: null
        },
        services: { oss: { enabled: false, endpoint: null } }
      })
    ).toMatchObject({ artifacts: null })
  })

  it('keeps the unapproved product star repository disabled', () => {
    expect(getProductStarRepository()).toBeNull()
    expect(getProductStarRepository({ desktop: { starRepository: 'hivekernel/hivecode' } })).toBe(
      'hivekernel/hivecode'
    )
  })

  it('routes feedback through the product adapter without an upstream fallback', () => {
    const source = readFileSync(new URL('../ipc/feedback.ts', import.meta.url), 'utf8')

    expect(source).toContain('getProductExternalServiceEndpoints().feedback')
    expect(source).not.toContain('onorca.dev')
  })
})
