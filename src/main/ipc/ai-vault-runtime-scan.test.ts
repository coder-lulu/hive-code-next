import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import { scanRuntimeAiVaultSessions } from './ai-vault-runtime-scan'

describe('runtime AI Vault scan', () => {
  it('preserves a remote scanner error verbatim', async () => {
    const message = 'Could not scan C:\\customer Orca workspace; https://orca.dev'
    const result = await scanRuntimeAiVaultSessions({
      hostInfo: {
        environmentId: 'remote-server',
        executionHostId: 'runtime:remote-server'
      },
      scanner: () => Promise.reject(new Error(message))
    })

    expect(result.issues).toEqual([expect.objectContaining({ message })])
  })

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
