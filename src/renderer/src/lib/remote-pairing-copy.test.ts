import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { translateRemotePairingFailureDescription } from './remote-pairing-copy'

describe('remote pairing copy', () => {
  it.each(['host-identity-mismatch', 'host-unreachable'] as const)(
    'uses the product name when the %s endpoint is unavailable',
    (kind) => {
      const message = translateRemotePairingFailureDescription(kind, null)

      expect(message).toContain(APP_DISPLAY_NAME)
      expect(message).not.toMatch(/\bOrca\b/)
    }
  )
})
