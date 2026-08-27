import { describe, expect, it, vi } from 'vitest'
import {
  allowsPlaintextOrcaCloudSession,
  getOrcaCloudAuthConfig,
  isOrcaCloudDevAuthEnabled,
  type ProductCloudDefaults
} from './profile-cloud-auth-config'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

const TEST_PRODUCT_DEFAULTS: ProductCloudDefaults = {
  apiBaseUrl: 'https://login.example.test',
  clientId: 'desktop-client',
  relayDirectorUrl: 'https://relay.example.test',
  scope: 'openid test.product.scope',
  productLabel: 'Test Cloud'
}

describe('Orca cloud auth config', () => {
  it('reports unconfigured without both API URL and client ID', () => {
    expect(getOrcaCloudAuthConfig({}, undefined, TEST_PRODUCT_DEFAULTS)).toEqual({
      configured: false,
      setupMessage: 'Test Cloud sign-in is not configured for this build.'
    })
  })

  it('builds default desktop auth endpoints from the API URL', () => {
    const state = getOrcaCloudAuthConfig(
      {
        ORCA_CLOUD_API_URL: 'https://orca-cloud.example/',
        ORCA_CLOUD_CLIENT_ID: 'desktop-client'
      },
      undefined,
      TEST_PRODUCT_DEFAULTS
    )

    expect(state).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://orca-cloud.example',
        authorizeEndpoint: 'https://orca-cloud.example/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://orca-cloud.example/v1/desktop/auth/session',
        refreshEndpoint: 'https://orca-cloud.example/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://orca-cloud.example/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://orca-cloud.example/v1/desktop/auth/profile',
        orgEndpoint: 'https://orca-cloud.example/v1/desktop/auth/org',
        logoutEndpoint: 'https://orca-cloud.example/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://orca-cloud.example/v1/desktop/auth/relay-token',
        relayDirectorUrl: 'https://relay.example.test',
        clientId: 'desktop-client',
        scope: 'openid test.product.scope'
      }
    })
  })

  it('uses first-party production endpoints without runtime env in packaged builds', () => {
    expect(getOrcaCloudAuthConfig({}, true, TEST_PRODUCT_DEFAULTS)).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://login.example.test',
        authorizeEndpoint: 'https://login.example.test/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://login.example.test/v1/desktop/auth/session',
        refreshEndpoint: 'https://login.example.test/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://login.example.test/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://login.example.test/v1/desktop/auth/profile',
        orgEndpoint: 'https://login.example.test/v1/desktop/auth/org',
        logoutEndpoint: 'https://login.example.test/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://login.example.test/v1/desktop/auth/relay-token',
        relayDirectorUrl: 'https://relay.example.test',
        clientId: 'desktop-client',
        scope: 'openid test.product.scope'
      }
    })
  })

  it('allows loopback HTTP endpoints for local desktop auth development', () => {
    const state = getOrcaCloudAuthConfig(
      {
        ORCA_CLOUD_API_URL: 'http://localhost:4100',
        ORCA_CLOUD_CLIENT_ID: 'desktop-client'
      },
      undefined,
      TEST_PRODUCT_DEFAULTS
    )

    expect(state.configured).toBe(true)
  })

  it('ignores all endpoint environment overrides in packaged builds', () => {
    const state = getOrcaCloudAuthConfig(
      {
        ORCA_CLOUD_API_URL: 'http://localhost:4100',
        ORCA_CLOUD_CLIENT_ID: 'overridden-client',
        ORCA_RELAY_URL: 'http://localhost:4101'
      },
      true,
      TEST_PRODUCT_DEFAULTS
    )
    expect(state).toMatchObject({
      configured: true,
      config: {
        apiBaseUrl: 'https://login.example.test',
        clientId: 'desktop-client',
        relayDirectorUrl: 'https://relay.example.test'
      }
    })
  })

  it('rejects non-HTTPS non-loopback API URLs', () => {
    expect(
      getOrcaCloudAuthConfig(
        {
          ORCA_CLOUD_API_URL: 'http://orca-cloud.example',
          ORCA_CLOUD_CLIENT_ID: 'desktop-client'
        },
        undefined,
        TEST_PRODUCT_DEFAULTS
      )
    ).toMatchObject({ configured: false })
  })

  it('allows dev plaintext sessions only outside production', () => {
    expect(
      allowsPlaintextOrcaCloudSession({
        ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      allowsPlaintextOrcaCloudSession({
        ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })

  it('ignores dev flags in packaged builds even without NODE_ENV', () => {
    // Why: packaged main bundles never define NODE_ENV, so packaged-ness must
    // gate the escape hatches on its own.
    expect(allowsPlaintextOrcaCloudSession({ ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION: '1' }, true)).toBe(
      false
    )
    expect(isOrcaCloudDevAuthEnabled({ ORCA_CLOUD_DEV_AUTH: '1' }, true)).toBe(false)
  })

  it('allows local dev auth only outside production', () => {
    expect(
      isOrcaCloudDevAuthEnabled({
        ORCA_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      isOrcaCloudDevAuthEnabled({
        ORCA_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })
})
