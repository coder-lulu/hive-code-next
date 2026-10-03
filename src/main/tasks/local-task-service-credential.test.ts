import { describe, expect, it } from 'vitest'
import { createLocalTaskServiceCredential } from './local-task-service-credential'

describe('restricted local service credential', () => {
  it('authenticates only its generated secret', () => {
    const credential = createLocalTaskServiceCredential('service:one')
    expect(credential.authenticate(credential.secret)).toEqual({
      operationCallerKey: 'service:one'
    })
    expect(credential.authenticate('a'.repeat(43))).toBeNull()
    expect(credential.authenticate('é'.repeat(43))).toBeNull()
    expect(credential.authenticate('')).toBeNull()
  })
  it('keeps replay identity stable across secret rotation', () => {
    const first = createLocalTaskServiceCredential('service:one')
    const next = createLocalTaskServiceCredential('service:one')
    expect(next.secret).not.toBe(first.secret)
    expect(next.authenticate(first.secret)).toBeNull()
    expect(next.authenticate(next.secret)).toEqual(first.authenticate(first.secret))
  })
})
