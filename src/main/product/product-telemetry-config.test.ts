import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveProductTelemetryTransport } from './product-telemetry-config'

const valid = {
  enabled: true,
  buildIdentity: 'stable' as const,
  writeKey: 'test-write-key',
  endpoint: 'https://telemetry.example.test'
}

describe('product telemetry config', () => {
  it('wires the telemetry client only through the product endpoint adapter', () => {
    const source = readFileSync(new URL('../telemetry/client.ts', import.meta.url), 'utf8')

    expect(source).toContain('getProductExternalServiceEndpoints().telemetry')
    expect(source).toContain('host: telemetryTransport.host')
    expect(source).not.toContain('us.i.posthog.com')
  })

  it('returns only an explicitly configured product transport', () => {
    expect(resolveProductTelemetryTransport(valid)).toEqual({
      channel: 'stable',
      writeKey: 'test-write-key',
      host: 'https://telemetry.example.test/'
    })
  })

  it.each([
    { ...valid, enabled: false },
    { ...valid, buildIdentity: null },
    { ...valid, buildIdentity: 'dev' },
    { ...valid, writeKey: null },
    { ...valid, writeKey: '' },
    { ...valid, endpoint: null },
    { ...valid, endpoint: '' }
  ])('fails closed when a transport prerequisite is absent', (input) => {
    expect(resolveProductTelemetryTransport(input)).toBeNull()
  })

  it.each([
    'http://telemetry.example.test',
    'https://user:secret@telemetry.example.test',
    'https://telemetry.example.test/?token=secret',
    'https://telemetry.example.test/#fragment',
    'file:///tmp/telemetry'
  ])('fails closed for unsafe telemetry endpoint %s', (endpoint) => {
    expect(resolveProductTelemetryTransport({ ...valid, endpoint })).toBeNull()
  })
})
