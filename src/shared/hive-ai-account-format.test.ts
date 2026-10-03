import { describe, expect, it, vi } from 'vitest'
import { formatAiInteger } from './hive-ai-account'
import { formatAiPrice } from './hive-ai-model-candidates'

describe('AI amount formatting', () => {
  it.each([
    ['zh-CN', '9,007,199,254,740,993'],
    ['de-DE', '9.007.199.254.740.993'],
    ['fr-FR', '9\u202f007\u202f199\u202f254\u202f740\u202f993'],
    ['hi-IN', '9,00,71,99,25,47,40,993'],
    ['ar-EG', '٩٬٠٠٧٬١٩٩٬٢٥٤٬٧٤٠٬٩٩٣']
  ])('preserves large quota digits in %s', (locale, expected) => {
    expect(formatAiInteger('9007199254740993', locale)).toBe(expected)
  })

  it('keeps signed values, zero, and unavailable amounts distinct', () => {
    expect(formatAiInteger('-9223372036854775808', 'en-US')).toBe('-9,223,372,036,854,775,808')
    expect(formatAiInteger('0', 'zh-CN')).toBe('0')
    expect(formatAiInteger(null, 'zh-CN')).toBe('—')
  })

  it.each(['en-US', 'fr-FR', 'hi-IN', 'ar-EG'])(
    'matches the locale grouping for a 64-digit price in %s',
    (locale) => {
      const integer = `${'1234567890'.repeat(6)}1234`
      expect(formatAiPrice(integer, locale)).toBe(
        new Intl.NumberFormat(locale).format(BigInt(integer))
      )
    }
  )

  it('renders quota and model prices when Android Hermes rejects BigInt in NumberFormat', () => {
    const NativeNumberFormat = Intl.NumberFormat
    const spy = vi.spyOn(Intl, 'NumberFormat').mockImplementation(function (locale, options) {
      const native = new NativeNumberFormat(locale, options)
      return new Proxy(native, {
        get(target, property) {
          if (property === 'format') {
            return (value: number | bigint) => {
              if (typeof value === 'bigint') {
                throw new TypeError('Cannot convert BigInt to number')
              }
              return target.format(value)
            }
          }
          const member: unknown = target[property as keyof Intl.NumberFormat]
          return typeof member === 'function' ? member.bind(target) : member
        }
      })
    })
    try {
      expect(formatAiInteger('9007199254740993', 'zh-CN')).toBe('9,007,199,254,740,993')
      expect(formatAiPrice('9007199254740993.123456789012', 'en-US')).toBe(
        '9,007,199,254,740,993.123456789012'
      )
    } finally {
      spy.mockRestore()
    }
  })
})
