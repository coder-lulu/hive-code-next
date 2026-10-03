import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const EXPECTED_PATHS = ['/asset', '/download', '/page', '/redirect', '/secure', '/socket']
const remoteHost = `browser-egress-${randomUUID()}.invalid`
const required = Boolean(process.env.CI)
let electronAvailable = false
let dnsUnavailable: string | null = null
try {
  const binary: unknown = createRequire(import.meta.url)('electron')
  electronAvailable = typeof binary === 'string' && existsSync(binary)
} catch {
  // Local dependency availability is explicit; CI still requires the actual executable.
}
if (electronAvailable) {
  const { assertLocallyUnresolvable } = await import('./browser-route-tcp-egress-fixture')
  try {
    await assertLocallyUnresolvable(remoteHost)
  } catch (error) {
    dnsUnavailable = error instanceof Error ? error.message : String(error)
  }
}
const protectedAvailable = electronAvailable && dnsUnavailable === null
const unavailableReason = electronAvailable
  ? 'local DNS defeats required NXDOMAIN oracle'
  : 'Electron executable unavailable'

describe('browser route TCP egress under Electron', () => {
  it.runIf(electronAvailable || required)(
    'observes direct browser TCP surfaces under Electron',
    async () => {
      expect(electronAvailable, 'Electron executable is required').toBe(true)
      const { runBrowserRouteTcpEgressProbe } = await import('./browser-route-tcp-egress-fixture')
      const baseline = await runBrowserRouteTcpEgressProbe(false, remoteHost)
      expect(baseline.resolvedProxy).toBe('DIRECT')
      expect(baseline.directPaths).toEqual(EXPECTED_PATHS)
      expect(baseline.routedPaths).toEqual([])
    },
    60_000
  )

  it.runIf(protectedAvailable || required)(
    `routes browser TCP surfaces and remote DNS through the fixed SOCKS session${protectedAvailable ? '' : ` (not tested: ${unavailableReason})`}`,
    async () => {
      expect(electronAvailable, 'Electron executable is required').toBe(true)
      expect(dnsUnavailable, 'Protected egress requires a real local NXDOMAIN oracle').toBeNull()
      const { runBrowserRouteTcpEgressProbe } = await import('./browser-route-tcp-egress-fixture')
      const protectedSession = await runBrowserRouteTcpEgressProbe(true, remoteHost)
      expect(protectedSession.resolvedProxy).toMatch(/^SOCKS5 127\.0\.0\.1:\d+$/)
      expect(protectedSession.directPaths).toEqual([])
      expect(protectedSession.routedPaths).toEqual(EXPECTED_PATHS)
      // Chromium may route an unrelated background request through the same proxy.
      // The target-host observation is the causal DNS/routing oracle for this fixture.
      expect(protectedSession.socksHosts).toContain(remoteHost)
    },
    60_000
  )
})
