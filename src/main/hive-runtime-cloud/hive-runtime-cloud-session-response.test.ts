import { describe, expect, it } from 'vitest'
import {
  normalizeRuntimeSession,
  normalizeRuntimeSessionPage
} from './hive-runtime-cloud-session-response'

const session = {
  managedWebSessionId: '11111111-1111-4111-8111-111111111111',
  runtimeRecordId: '22222222-2222-4222-8222-222222222222',
  runtimeInstanceId: '33333333-3333-4333-8333-333333333333',
  runtimeSessionId: '44444444-4444-4444-8444-444444444444',
  clientKind: 'MOBILE',
  clientLabel: 'Ada phone',
  status: 'ACTIVE',
  resourceVersion: 2,
  controlVersion: 3,
  createdAt: '2026-08-31T00:00:00.000Z',
  expiresAt: '2026-08-31T01:00:00.000Z',
  revokeRequestedAt: null,
  revokeAcknowledgedAt: null
}

describe('Hive Runtime Cloud session responses', () => {
  it('normalizes the client-kind-neutral session contract', () => {
    expect(normalizeRuntimeSession(session)).toEqual({
      ...session,
      createdAt: Date.parse(session.createdAt),
      expiresAt: Date.parse(session.expiresAt)
    })
  })

  it('parses stable pagination from the response body', () => {
    expect(
      normalizeRuntimeSessionPage({ items: [session], nextCursor: 'next-cursor' })
    ).toMatchObject({
      items: [{ managedWebSessionId: session.managedWebSessionId }],
      nextCursor: 'next-cursor'
    })
  })

  it.each([
    { ...session, ownerAccountId: 'must-not-leak' },
    { ...session, status: 'UNKNOWN' },
    { ...session, clientLabel: 'bad\nlabel' },
    { ...session, expiresAt: session.createdAt }
  ])('rejects malformed or privacy-expanding fields %#', (value) => {
    expect(() => normalizeRuntimeSession(value)).toThrow()
  })
})
