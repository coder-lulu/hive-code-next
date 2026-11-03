import { expect, it } from 'vitest'
import { chatWorkerErrorEscalationEnabled } from './chat-worker-error-escalation'

it('enables shipped chat escalation by default and honors an explicit opt-out', () => {
  expect(chatWorkerErrorEscalationEnabled(undefined)).toBe(true)
  expect(chatWorkerErrorEscalationEnabled({})).toBe(true)
  expect(chatWorkerErrorEscalationEnabled({ orchestrationChatErrorEscalationEnabled: true })).toBe(
    true
  )
  expect(chatWorkerErrorEscalationEnabled({ orchestrationChatErrorEscalationEnabled: false })).toBe(
    false
  )
})
