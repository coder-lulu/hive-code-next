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
})
