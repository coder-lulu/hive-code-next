import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import { scanRuntimeAiVaultSessions } from './ai-vault-runtime-scan'

describe('runtime AI Vault scan', () => {
  it('uses the product brand when a remote scanner rejects without an Error', async () => {
    const result = await scanRuntimeAiVaultSessions({
      hostInfo: {
        environmentId: 'remote-server',
        executionHostId: 'runtime:remote-server'
      },
      scanner: () => Promise.reject('offline')
    })

    expect(result.issues).toEqual([
      expect.objectContaining({
        executionHostId: 'runtime:remote-server',
        message: `Remote ${APP_DISPLAY_NAME} server is unavailable.`
      })
    ])
  })
})
