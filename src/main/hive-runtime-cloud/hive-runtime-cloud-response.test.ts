import { describe, expect, it } from 'vitest'
import { normalizeConnectionTicketConsume } from './hive-runtime-cloud-response'

describe('Hive Runtime Cloud response normalization', () => {
  it('normalizes only the frozen Connection Ticket consume response', () => {
    expect(
      normalizeConnectionTicketConsume({
        managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
        runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
        status: 'ACTIVE',
        expiresAt: '2026-08-25T09:00:00.000Z',
        controlVersion: 1
      })
    ).toEqual({
      managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
      runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
      status: 'ACTIVE',
      expiresAt: Date.parse('2026-08-25T09:00:00.000Z'),
      controlVersion: 1
    })
  })

  it.each([
    { status: 'REVOKED' },
    { controlVersion: 0 },
    { ownerAccountId: 'not-part-of-the-contract' }
  ])('rejects an invalid or expanded consume response: %o', (change) => {
    const value = {
      managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
      runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
      status: 'ACTIVE',
      expiresAt: '2026-08-25T09:00:00.000Z',
      controlVersion: 1,
      ...change
    }

    expect(() => normalizeConnectionTicketConsume(value)).toThrow(
      'invalid_hive_runtime_cloud_response'
    )
  })
})
