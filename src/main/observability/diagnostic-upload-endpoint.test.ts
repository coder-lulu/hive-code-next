import { afterEach, describe, expect, it } from 'vitest'
import { resolveDiagnosticTokenEndpoint } from './diagnostic-upload-endpoint'

const originalEnv = process.env.ORCA_DIAGNOSTICS_TOKEN_URL

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.ORCA_DIAGNOSTICS_TOKEN_URL
  } else {
    process.env.ORCA_DIAGNOSTICS_TOKEN_URL = originalEnv
  }
  delete (globalThis as { ORCA_DIAGNOSTICS_TOKEN_URL?: unknown }).ORCA_DIAGNOSTICS_TOKEN_URL
})

describe('diagnostic upload endpoint', () => {
  it('ignores legacy environment and build overrides when the product endpoint is disabled', () => {
    process.env.ORCA_DIAGNOSTICS_TOKEN_URL = 'https://attacker.example.test/token'
    ;(globalThis as { ORCA_DIAGNOSTICS_TOKEN_URL?: string }).ORCA_DIAGNOSTICS_TOKEN_URL =
      'https://legacy.example.test/token'

    expect(resolveDiagnosticTokenEndpoint({ diagnostics: null })).toBeNull()
  })

  it('uses only the explicit product diagnostics endpoint', () => {
    expect(
      resolveDiagnosticTokenEndpoint({
        diagnostics: 'https://diagnostics.example.test/token'
      })
    ).toBe('https://diagnostics.example.test/token')
  })

  it.each([
    'http://diagnostics.example.test/token',
    'https://user:secret@diagnostics.example.test/token',
    'https://diagnostics.example.test/token?secret=value',
    'https://diagnostics.example.test/token#fragment'
  ])('fails closed for unsafe diagnostics endpoint %s', (diagnostics) => {
    expect(resolveDiagnosticTokenEndpoint({ diagnostics })).toBeNull()
  })
})
