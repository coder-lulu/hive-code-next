import { describe, expect, it } from 'vitest'
import { mobileConnectionPathLabel } from './mobile-connection-path-label'
import { APP_DISPLAY_NAME } from '@/product-brand'

describe('mobile connection path label', () => {
  it('distinguishes LAN, Tailscale, and the relay without exposing transport errors', () => {
    expect(mobileConnectionPathLabel('lan')).toBe('Direct · LAN')
    expect(mobileConnectionPathLabel('tailscale')).toBe('Direct · Tailscale')
    expect(mobileConnectionPathLabel('relay')).toBe(`${APP_DISPLAY_NAME} Relay`)
  })
})
