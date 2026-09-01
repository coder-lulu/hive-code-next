import { describe, expect, it } from 'vitest'
import type { HiveRuntimeDisplayNameError } from './hive-runtime-display-name'
import {
  isNormalizedHiveRuntimeDisplayName,
  normalizeHiveRuntimeDisplayName,
  resolveHiveRuntimeDisplayName
} from './hive-runtime-display-name'

describe('Hive Runtime display names', () => {
  it('counts Unicode code points instead of UTF-16 code units', () => {
    const emojiName = '🐝'.repeat(128)

    expect(normalizeHiveRuntimeDisplayName(` ${emojiName} `)).toBe(emojiName)
    expect(() => normalizeHiveRuntimeDisplayName(`${emojiName}🐝`)).toThrowError(
      expect.objectContaining<Partial<HiveRuntimeDisplayNameError>>({ code: 'TOO_LONG' })
    )
  })

  it('accepts paired emoji surrogates but rejects lone UTF-16 surrogates', () => {
    expect(isNormalizedHiveRuntimeDisplayName('Desk 🐝')).toBe(true)
    expect(isNormalizedHiveRuntimeDisplayName('Desk\ud800')).toBe(false)
    expect(isNormalizedHiveRuntimeDisplayName('Desk\udc00')).toBe(false)
  })

  it.each(['Desk\nInjected', 'Desk\u202eabc', 'Desk\u2066abc', 'Desk\u206fabc'])(
    'rejects unsafe control text %#',
    (name) => {
      expect(isNormalizedHiveRuntimeDisplayName(name)).toBe(false)
    }
  )

  it('does not expand the bidi policy to ordinary Unicode separators', () => {
    expect(isNormalizedHiveRuntimeDisplayName('Desk\u2028Line')).toBe(true)
    expect(isNormalizedHiveRuntimeDisplayName('Desk\u2029Paragraph')).toBe(true)
  })

  it('requires already-normalized server values', () => {
    expect(isNormalizedHiveRuntimeDisplayName('Desk')).toBe(true)
    expect(isNormalizedHiveRuntimeDisplayName(' Desk ')).toBe(false)
    expect(normalizeHiveRuntimeDisplayName(' Cafe\u0301 ')).toBe('Café')
    expect(isNormalizedHiveRuntimeDisplayName('Cafe\u0301')).toBe(false)
  })

  it('resolves pending, cloud, local, reported, and short-id names in order', () => {
    const base = {
      runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cloudDisplayName: 'Cloud',
      localPairedName: 'Local',
      reportedDeviceName: 'Reported'
    }

    expect(resolveHiveRuntimeDisplayName({ ...base, pendingDesiredName: 'Pending' })).toBe(
      'Pending'
    )
    expect(resolveHiveRuntimeDisplayName(base)).toBe('Cloud')
    expect(resolveHiveRuntimeDisplayName({ ...base, pendingDesiredName: null })).toBe('Local')
    expect(resolveHiveRuntimeDisplayName({ ...base, cloudDisplayName: null })).toBe('Local')
    expect(
      resolveHiveRuntimeDisplayName({ ...base, cloudDisplayName: null, localPairedName: null })
    ).toBe('Reported')
    expect(
      resolveHiveRuntimeDisplayName({
        ...base,
        cloudDisplayName: null,
        localPairedName: null,
        reportedDeviceName: null
      })
    ).toBe('Runtime aaaaaaaa')
  })
})
