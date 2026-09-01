import { describe, expect, it, vi } from 'vitest'
import { LinearAgentAccessError, sanitizeLinearErrorMessage } from './issue-context-errors'

describe('sanitizeLinearErrorMessage', () => {
  it('preserves provider text in the structured error', () => {
    const message = 'Linear project Orca migration is blocked at C:\\customer Orca workspace'
    expect(new LinearAgentAccessError('linear_network_error', message).message).toBe(message)
  })

  it('removes stack frames without regex line splitting', () => {
    const splitSpy = vi.spyOn(String.prototype, 'split')
    try {
      expect(
        sanitizeLinearErrorMessage('Linear request failed\r\n    at request (sdk.js:10:2)')
      ).toBe('Linear request failed')
      const usedStackSplit = splitSpy.mock.calls.some(
        ([separator]) => separator instanceof RegExp && separator.source === '\\r?\\n\\s+at\\s+'
      )
      expect(usedStackSplit).toBe(false)
    } finally {
      splitSpy.mockRestore()
    }
  })

  it('redacts sensitive Linear payloads after trimming stack frames', () => {
    expect(
      sanitizeLinearErrorMessage(
        'Request failed authorization: Bearer secret-token\n    at request (sdk.js:10:2)'
      )
    ).toBe('Request failed authorization: Bearer [REDACTED]')
  })
})
