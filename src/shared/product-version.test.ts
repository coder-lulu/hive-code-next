import { describe, expect, it } from 'vitest'
import {
  compareProductVersions,
  isBetaProductVersion,
  isLegacyRcProductVersion,
  isProductVersion,
  isProductVersionForChannel,
  isStableProductVersion,
  normalizeProductVersion
} from './product-version'

describe('HiveCode product version contract', () => {
  it('accepts stable and beta versions', () => {
    expect(isStableProductVersion('1.5.0')).toBe(true)
    expect(isBetaProductVersion('1.5.0-beta.1')).toBe(true)
    expect(isProductVersion('1.4.178-rc.7')).toBe(true)
  })

  it('rejects tag prefixes, leading zeroes, and unknown suffixes', () => {
    for (const value of ['v1.5.0', '1.05.0', '1.5', '1.5.0-', '1.5.0-internal.1']) {
      expect(isProductVersion(value)).toBe(false)
    }
    expect(isProductVersion(' 1.5.0')).toBe(false)
  })

  it('uses channel semantics for new releases while preserving legacy RC reads', () => {
    expect(isProductVersionForChannel('1.5.0', 'stable')).toBe(true)
    expect(isProductVersionForChannel('1.5.0-beta.1', 'beta')).toBe(true)
    expect(isProductVersionForChannel('1.5.0', 'beta')).toBe(false)
    expect(isProductVersionForChannel('1.5.0', 'internal')).toBe(true)
    expect(isProductVersionForChannel('1.5.0-beta.1', 'internal')).toBe(true)
    expect(isProductVersionForChannel('1.5.0-beta.1', 'stable')).toBe(false)
    expect(isLegacyRcProductVersion('1.4.178-rc.7')).toBe(true)
  })

  it('normalizes a Git tag only at the boundary', () => {
    expect(normalizeProductVersion('v1.5.0-beta.1')).toBe('1.5.0-beta.1')
    expect(normalizeProductVersion('1.5.0+build.1')).toBe(null)
  })

  it('orders legacy RC, beta, stable, and build increments without downgrades', () => {
    expect(compareProductVersions('1.4.178-rc.7', '1.5.0-beta.1')).toBe(-1)
    expect(compareProductVersions('1.5.0-beta.1', '1.5.0-beta.2')).toBe(-1)
    expect(compareProductVersions('1.5.0-beta.1', '1.5.0')).toBe(-1)
    expect(compareProductVersions('1.5.0', '1.5.0')).toBe(0)
  })

  it('compares large numeric identifiers without precision loss', () => {
    expect(compareProductVersions('999999999999999999999999.0.0', '1.0.0')).toBeGreaterThan(0)
    expect(
      compareProductVersions('1.0.0-beta.999999999999999999999999', '1.0.0-beta.2')
    ).toBeGreaterThan(0)
  })
})
