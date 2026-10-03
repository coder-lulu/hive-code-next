import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from './brand'
import { browserUnavailableMessage } from './runtime-session-contracts'

describe('browserUnavailableMessage', () => {
  it('uses the product brand while preserving the compatibility environment variable', () => {
    const message = browserUnavailableMessage('unconfigured')

    expect(message).toContain(`Install the ${APP_DISPLAY_NAME} desktop app`)
    expect(message).toContain('ORCA_BROWSER_EXECUTABLE')
    expect(message).not.toMatch(/\bOrca\b/)
  })
})
