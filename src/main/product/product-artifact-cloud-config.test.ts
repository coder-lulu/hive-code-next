import { describe, expect, it, vi } from 'vitest'
import { getProductArtifactCloudConfig } from './product-artifact-cloud-config'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

describe('product artifact cloud config', () => {
  it('fails closed in packaged builds when no product endpoint is configured', () => {
    expect(
      getProductArtifactCloudConfig(
        'https://share.onorca.dev',
        { ORCA_ARTIFACTS_API_URL: 'https://share.onorca.dev' },
        true,
        null
      )
    ).toEqual({
      configured: false,
      setupMessage: 'Artifact sharing is not configured for this product.'
    })
  })

  it('uses only the configured product endpoint in packaged builds', () => {
    expect(
      getProductArtifactCloudConfig(
        'https://override.example.test',
        { ORCA_ARTIFACTS_API_URL: 'https://environment.example.test' },
        true,
        'https://artifacts.example.test'
      )
    ).toEqual({ configured: true, apiUrl: 'https://artifacts.example.test' })
  })

  it('allows explicit HTTPS and loopback endpoints in development', () => {
    expect(getProductArtifactCloudConfig('http://localhost:45961', {}, false, null)).toEqual({
      configured: true,
      apiUrl: 'http://localhost:45961'
    })
    expect(
      getProductArtifactCloudConfig(
        undefined,
        { ORCA_ARTIFACTS_API_URL: 'https://artifacts.example.test' },
        false,
        null
      )
    ).toEqual({ configured: true, apiUrl: 'https://artifacts.example.test' })
  })

  it('rejects loopback HTTP in packaged builds', () => {
    expect(() =>
      getProductArtifactCloudConfig(undefined, {}, true, 'http://localhost:45961')
    ).toThrow(/HTTPS/)
  })
})
