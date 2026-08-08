import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  getProductExternalServiceEndpoints,
  getProductStarRepository
} from './product-external-service-endpoints'

describe('product external service endpoints', () => {
  it('keeps every unapproved HiveCode service disabled', () => {
    expect(getProductExternalServiceEndpoints()).toEqual({
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
      feedback: 'https://feedback.example.test',
      pluginKillList: 'https://plugins.example.test/kill-list.json',
      pluginMarketplace: 'https://github.example.test/hive/plugins.git',
      changelog: 'https://updates.example.test/changelog.json',
      nudge: 'https://updates.example.test/nudge.json',
      telemetry: 'https://telemetry.example.test',
      diagnostics: 'https://diagnostics.example.test/token'
    })
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
