import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from './brand'
import {
  EXTERNAL_AUTOMATION_SCOPE_CODES,
  ExternalAutomationScopeError
} from './external-automation-scope'

describe('ExternalAutomationScopeError', () => {
  it('brands the user-facing managed-host refusal without changing its stable code', () => {
    const error = new ExternalAutomationScopeError(EXTERNAL_AUTOMATION_SCOPE_CODES.targetHidden)

    expect(error.code).toBe('external_automation_target_hidden')
    expect(error.message).toContain(APP_DISPLAY_NAME)
    expect(error.message).not.toMatch(/\bOrca\b/)
  })
})
