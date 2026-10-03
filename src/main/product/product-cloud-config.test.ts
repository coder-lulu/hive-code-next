import { describe, expect, it, vi } from 'vitest'
import { getProductCloudAuthConfig } from './product-cloud-config'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

describe('HiveCode cloud auth config', () => {
  it('uses the grouped product manifest in packaged HiveCode builds', () => {
    const result = getProductCloudAuthConfig({}, true)

    expect(result.configured).toBe(true)
    if (result.configured) {
      expect(result.config.apiBaseUrl).toBe('https://api.hivekernel.com')
    }
  })

  it('does not fall back to Orca production endpoints in packaged HiveCode builds', () => {
    const result = getProductCloudAuthConfig({}, true)

    expect(result.configured).toBe(true)
    if (result.configured) {
      expect(result.config.apiBaseUrl).not.toMatch(/onorca|orca\.dev/i)
    }
  })

  it('ignores ORCA_CLOUD_* env overrides in packaged HiveCode builds', () => {
    const result = getProductCloudAuthConfig(
      {
        ORCA_CLOUD_API_URL: 'https://hivecode-cloud.example',
        ORCA_CLOUD_CLIENT_ID: 'desktop-client'
      },
      true
    )

    expect(result.configured).toBe(true)
  })

  it('allows ORCA_CLOUD_* env vars in dev / unpackaged builds', () => {
    const result = getProductCloudAuthConfig({
      ORCA_CLOUD_API_URL: 'https://orca-cloud.example/',
      ORCA_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(result.configured).toBe(true)
    if (result.configured) {
      expect(result.config.authorizeEndpoint).toContain('/v1/desktop/auth/authorize')
      expect(result.config.scope).toBe('openid profile email offline_access hive.session.exchange')
    }
  })

  it('allows an explicit development scope to override the HiveCode default', () => {
    const result = getProductCloudAuthConfig({
      ORCA_CLOUD_API_URL: 'https://orca-cloud.example/',
      ORCA_CLOUD_CLIENT_ID: 'desktop-client',
      ORCA_CLOUD_AUTH_SCOPE: 'openid profile email offline_access'
    })

    expect(result.configured).toBe(true)
    if (result.configured) {
      expect(result.config.scope).toBe('openid profile email offline_access')
    }
  })

  it('reports unconfigured in dev without env vars (no production fallback)', () => {
    const result = getProductCloudAuthConfig({})

    expect(result.configured).toBe(false)
    if (!result.configured) {
      expect(result.setupMessage).toContain('not configured')
    }
  })

  it('allows loopback HTTP endpoints in dev', () => {
    const result = getProductCloudAuthConfig({
      ORCA_CLOUD_API_URL: 'http://localhost:4100',
      ORCA_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(result.configured).toBe(true)
  })

  it('rejects loopback HTTP endpoints in packaged HiveCode builds', () => {
    const result = getProductCloudAuthConfig(
      {
        ORCA_CLOUD_API_URL: 'http://localhost:4100',
        ORCA_CLOUD_CLIENT_ID: 'desktop-client'
      },
      true
    )

    expect(result.configured).toBe(true)
    if (result.configured) {
      expect(result.config.apiBaseUrl).toBe('https://api.hivekernel.com')
    }
  })

  it('allows Cloud auth when API and client are configured', () => {
    const result = getProductCloudAuthConfig({
      ORCA_CLOUD_API_URL: 'https://hivecode-cloud.example',
      ORCA_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(result.configured).toBe(true)
  })
})
