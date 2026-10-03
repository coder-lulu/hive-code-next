import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { getHiveRuntimeCloudConfig } from './hive-runtime-cloud-config'

const configuredApiBaseUrl = 'https://api.hivekernel.com'

function cloudEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HIVE_PRODUCT_API_BASE_URL: configuredApiBaseUrl,
    ...overrides
  }
}

beforeEach(() => vi.unstubAllEnvs())

describe('Hive Runtime Cloud config', () => {
  it('enables Runtime Cloud by default when the HiveCode account origin is configured', () => {
    expect(getHiveRuntimeCloudConfig({})).toEqual({
      enabled: true,
      apiBaseUrl: 'https://api.hivekernel.com'
    })
  })

  it('reuses the validated Hive account Cloud origin when explicitly enabled', () => {
    expect(getHiveRuntimeCloudConfig(cloudEnv())).toEqual({
      enabled: true,
      apiBaseUrl: configuredApiBaseUrl
    })
  })

  it('publishes Web Launch only with an explicit HTTPS origin and safe paths', () => {
    expect(
      getHiveRuntimeCloudConfig(
        cloudEnv({
          HIVE_RUNTIME_CLOUD_WEB_HTTPS_ORIGIN: 'https://runtime.hive.test',
          HIVE_RUNTIME_CLOUD_WEB_CLIENT_PATH: '/web-index.html',
          HIVE_RUNTIME_CLOUD_WEBSOCKET_PATH: '/_hive/runtime-rpc'
        })
      )
    ).toEqual({
      enabled: true,
      apiBaseUrl: configuredApiBaseUrl,
      webLaunch: {
        publicOrigin: 'https://runtime.hive.test',
        webClientPath: '/web-index.html',
        websocketPath: '/_hive/runtime-rpc'
      }
    })
  })

  it.each([
    ['http://runtime.hive.test', '/web-index.html', '/_hive/runtime-rpc'],
    ['https://runtime.hive.test:8443', '/web-index.html', '/_hive/runtime-rpc'],
    ['https://user:secret@runtime.hive.test', '/web-index.html', '/_hive/runtime-rpc'],
    ['https://runtime.hive.test', '//evil.example/web-index.html', '/_hive/runtime-rpc'],
    ['https://runtime.hive.test', '/web-index.html', '/_hive/runtime-rpc?token=x']
  ])('fails closed for an unsafe Web Launch endpoint', (origin, webClientPath, websocketPath) => {
    expect(
      getHiveRuntimeCloudConfig(
        cloudEnv({
          HIVE_RUNTIME_CLOUD_WEB_HTTPS_ORIGIN: origin,
          HIVE_RUNTIME_CLOUD_WEB_CLIENT_PATH: webClientPath,
          HIVE_RUNTIME_CLOUD_WEBSOCKET_PATH: websocketPath
        })
      )
    ).toEqual({ enabled: true, apiBaseUrl: configuredApiBaseUrl })
  })
})
