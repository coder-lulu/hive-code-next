import { describe, expect, it } from 'vitest'
import { normalizeConnectionIntent } from './hive-runtime-cloud-connection-response'

describe('normalizeConnectionIntent', () => {
  it('accepts only the pinned Runtime key and HTTPS relay assignment shape', () => {
    expect(
      normalizeConnectionIntent({
        connectionIntentId: 'intent-1',
        ticketId: 'ticket-1',
        runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
        expiresAt: '2026-09-01T00:00:00.000Z',
        runtimePublicKeyB64: 'A'.repeat(43),
        relay: {
          cellUrl: 'https://relay.hivekernel.com',
          relayHostId: 'abcdefghijklmnop',
          assignmentEpoch: 2,
          e2eeFraming: 'hive-e2ee-v1'
        }
      })
    ).toMatchObject({
      expiresAt: Date.parse('2026-09-01T00:00:00.000Z'),
      relay: { e2eeFraming: 'hive-e2ee-v1' }
    })
  })

  it('rejects an insecure relay origin and unknown fields', () => {
    expect(() =>
      normalizeConnectionIntent({
        connectionIntentId: 'intent-1',
        ticketId: 'ticket-1',
        runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
        expiresAt: '2026-09-01T00:00:00.000Z',
        runtimePublicKeyB64: 'A'.repeat(43),
        relay: {
          cellUrl: 'http://relay.hivekernel.com',
          relayHostId: 'abcdefghijklmnop',
          assignmentEpoch: 2,
          e2eeFraming: 'hive-e2ee-v1'
        },
        ownerAccountId: 'must-not-leak'
      })
    ).toThrow()
  })

  it('rejects embedded relay credentials and a zero assignment epoch', () => {
    const intent = {
      connectionIntentId: 'intent-1',
      ticketId: 'ticket-1',
      runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
      expiresAt: '2026-09-01T00:00:00.000Z',
      runtimePublicKeyB64: 'A'.repeat(43),
      relay: {
        cellUrl: 'https://user:secret@relay.hivekernel.com',
        relayHostId: 'abcdefghijklmnop',
        assignmentEpoch: 2,
        e2eeFraming: 'hive-e2ee-v1'
      }
    }

    expect(() => normalizeConnectionIntent(intent)).toThrow()
    expect(() =>
      normalizeConnectionIntent({
        ...intent,
        relay: { ...intent.relay, cellUrl: 'https://relay.hivekernel.com', assignmentEpoch: 0 }
      })
    ).toThrow()
  })
})
