import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  PUSH_TEST_REFUSAL_REASONS,
  pushDeliveryTestResultSchema
} from './notification-reply-schema'

function reads<T>(schema: z.ZodType<T, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`expected a readable reply: ${parsed.error.message}`)
  }
  return parsed.data
}

function refuses(schema: z.ZodType<unknown, unknown>, value: unknown): boolean {
  return !schema.safeParse(value).success
}

describe('notification replies tolerate the shapes their call sites guard', () => {
  it('reads a test-push reply the screen reaches through optional chaining', () => {
    expect(reads(pushDeliveryTestResultSchema, { accepted: true })?.accepted).toBe(true)
    expect(reads(pushDeliveryTestResultSchema, null)).toBe(null)
    expect(reads(pushDeliveryTestResultSchema, undefined)).toBe(undefined)
    expect(reads(pushDeliveryTestResultSchema, { error: 'refused' })?.accepted).toBe(undefined)
  })

  // The screen interprets this inside a `try` that prints the thrown message, so a refusal would
  // replace the screen's generic fallback with the reader's own sentence.
  it('reads a non-object test-push result as absent, which takes the generic copy', () => {
    for (const value of ['garbage', 7, true, []]) {
      expect(refuses(pushDeliveryTestResultSchema, value)).toBe(false)
      const result = reads(pushDeliveryTestResultSchema, value)
      expect(result?.accepted).toBe(undefined)
      expect(result?.reason).toBe(undefined)
    }
  })
})

describe('closed enums degrade to the copy the existing screen showed', () => {
  it('keeps a reason the screen branches on and drops one it does not know', () => {
    expect(
      reads(pushDeliveryTestResultSchema, { accepted: false, reason: 'rate_limited' })?.reason
    ).toBe('rate_limited')
    expect(
      reads(pushDeliveryTestResultSchema, { accepted: false, reason: 'not_registered' })?.reason
    ).toBe('not_registered')
    expect(reads(pushDeliveryTestResultSchema, { accepted: false, reason: 'quota' })?.reason).toBe(
      undefined
    )
  })

  it('keeps every refusal reason the host declares for the delivery probe', () => {
    for (const reason of PUSH_TEST_REFUSAL_REASONS) {
      expect(reads(pushDeliveryTestResultSchema, { accepted: false, reason })?.reason).toBe(reason)
    }
  })
})
