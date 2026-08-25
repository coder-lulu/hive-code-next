import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('../../shared/generated/product-config', () => ({
  hivecodeProductConfig: {
    endpoints: {
      cloud: 'https://api.hivekernel.com',
      identityIssuer: 'https://identity.hivekernel.com/realms/hive'
    }
  }
}))

import { getHiveRuntimeCloudConfig } from './hive-runtime-cloud-config'

beforeEach(() => vi.unstubAllEnvs())

describe('Hive Runtime Cloud config', () => {
  it('is fail-closed by default', () => {
    expect(getHiveRuntimeCloudConfig({})).toEqual({ enabled: false })
  })

  it('reuses the validated Hive account Cloud origin when explicitly enabled', () => {
    expect(getHiveRuntimeCloudConfig({ HIVECODE_RUNTIME_CLOUD_PRESENCE_ENABLED: 'true' })).toEqual({
      enabled: true,
      apiBaseUrl: 'https://api.hivekernel.com'
    })
  })

  it('does not accept fuzzy truthy values', () => {
    expect(getHiveRuntimeCloudConfig({ HIVECODE_RUNTIME_CLOUD_PRESENCE_ENABLED: 'yes' })).toEqual({
      enabled: false
    })
  })

  it('enables Web Launch only for the frozen public HTTPS and WSS paths', () => {
    expect(
      getHiveRuntimeCloudConfig({
        HIVECODE_RUNTIME_CLOUD_PRESENCE_ENABLED: 'true',
        HIVECODE_RUNTIME_CLOUD_WEB_LAUNCH_ENABLED: 'true',
        HIVECODE_RUNTIME_CLOUD_WEB_HTTPS_ORIGIN: 'https://code.hivekernel.com',
        HIVECODE_RUNTIME_CLOUD_WEB_CLIENT_PATH: '/web-index.html',
        HIVECODE_RUNTIME_CLOUD_WEBSOCKET_PATH: '/_hive/runtime-rpc'
      })
    ).toEqual({
      enabled: true,
      apiBaseUrl: 'https://api.hivekernel.com',
      webLaunch: {
        publicOrigin: 'https://code.hivekernel.com',
        webClientPath: '/web-index.html',
        websocketPath: '/_hive/runtime-rpc'
      }
    })
  })

  it.each([
    ['http://code.hivekernel.com', '/web-index.html', '/_hive/runtime-rpc'],
    ['https://code.hivekernel.com', '//evil.example/web-index.html', '/_hive/runtime-rpc'],
    ['https://code.hivekernel.com', '/web-index.html', '/_hive/runtime-rpc?token=x']
  ])('fails closed for an unsafe Web Launch endpoint', (origin, webClientPath, websocketPath) => {
    expect(
      getHiveRuntimeCloudConfig({
        HIVECODE_RUNTIME_CLOUD_PRESENCE_ENABLED: 'true',
        HIVECODE_RUNTIME_CLOUD_WEB_LAUNCH_ENABLED: 'true',
        HIVECODE_RUNTIME_CLOUD_WEB_HTTPS_ORIGIN: origin,
        HIVECODE_RUNTIME_CLOUD_WEB_CLIENT_PATH: webClientPath,
        HIVECODE_RUNTIME_CLOUD_WEBSOCKET_PATH: websocketPath
      })
    ).toEqual({ enabled: true, apiBaseUrl: 'https://api.hivekernel.com' })
  })
})
