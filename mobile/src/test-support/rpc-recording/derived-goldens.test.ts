import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { derivedGoldens } from './derived-goldens'
import { readHiveGoldenDomain } from '../hive-golden-domain'
import { readScenarios } from './scenario-input'

const root = resolve(import.meta.dirname, '../../../..')
const input = readScenarios(
  process.env.RPC_FOUNDATION_SCENARIOS ??
    resolve(root, 'mobile/rpc-foundation/pilot-scenarios.json')
)
const directory =
  process.env.RPC_FOUNDATION_GOLDENS ?? resolve(root, 'mobile/rpc-foundation/goldens')

describe('derived goldens', () => {
  const domain = readHiveGoldenDomain(directory)
  const derived = derivedGoldens(input.scenarios).map((golden) => golden.id)

  it('distinguishes the frozen Hive overlay from a standalone recorder output', () => {
    const counts = {
      upstream: domain.upstreamIds.length,
      supported: domain.supportedIds.length,
      unsupported: domain.unsupportedIds.length
    }
    expect(counts.supported).toBeGreaterThan(0)
    expect(counts.supported + counts.unsupported).toBe(counts.upstream)
    if (domain.kind === 'standalone') {
      expect(counts).toEqual({
        upstream: derived.length,
        supported: derived.length,
        unsupported: 0
      })
    }
  })

  // Fails closed both ways inside the product domain: a supported golden the derivation dropped
  // stays frozen with nothing certifying it, and one it derives with no supported file was never
  // recorded. The 39 unsupported originals remain pinned by the upstream count and digest above.
  it('derives exactly the Hive manifest-supported goldens', () => {
    expect(derived.sort()).toEqual([...domain.supportedIds])
  })

  it('keeps retired desktop push-registration recordings outside the Hive product domain', () => {
    if (domain.kind !== 'hive-overlay') {
      return
    }
    const retired = [
      'matrix-notifications.push-registration-notifications.registerpush-1',
      'matrix-notifications.push-registration-notifications.unregisterpush-1',
      'notifications-push-gateway-rejected',
      'notifications-push-registered'
    ]
    expect(domain.upstreamIds).toEqual(expect.arrayContaining(retired))
    expect(domain.unsupportedIds).toEqual(expect.arrayContaining(retired))
    expect(derived).not.toEqual(expect.arrayContaining(retired))
  })
})
