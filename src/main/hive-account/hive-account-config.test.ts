import { describe, expect, it } from 'vitest'
import { getHiveAccountConfig } from './hive-account-config'

describe('Hive account product configuration', () => {
  it('uses the signed product manifest in packaged builds', () => {
    expect(
      getHiveAccountConfig(
        {
          HIVECODE_ACCOUNT_API_URL: 'https://attacker.example',
          HIVECODE_ACCOUNT_IDENTITY_ISSUER: 'https://attacker.example/realm'
        },
        true
      )
    ).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://api.hive.test',
        identityIssuer: 'https://identity.hive.test/realms/hive',
        clientId: 'hivecode-desktop',
        scope: 'openid profile email hive.session.exchange'
      }
    })
  })

  it('allows explicit loopback endpoints only in unpackaged development', () => {
    expect(
      getHiveAccountConfig(
        {
          HIVECODE_ACCOUNT_API_URL: 'http://127.0.0.1:8080',
          HIVECODE_ACCOUNT_IDENTITY_ISSUER: 'http://localhost:9090/realms/hive'
        },
        false
      )
    ).toMatchObject({ configured: true })
  })
})
