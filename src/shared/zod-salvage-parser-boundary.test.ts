import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { collectSalvageDrops, salvagedOptional } from './zod-salvage'

// Only the synchronous parser contract crosses this boundary; no schema implementation internals.
const integerText = {
  safeParse(raw: unknown): { success: true; data: number } | { success: false } {
    return typeof raw === 'string' && /^\d+$/.test(raw)
      ? { success: true, data: Number(raw) }
      : { success: false }
  }
}

const schema = z.object({ count: salvagedOptional('count', integerText) })

// This assignment also verifies that narrowing the parser does not erase its output type.
const parsedCount: number | undefined = schema.parse({ count: '7' }).count

describe('salvaged optional synchronous parser boundary', () => {
  it('keeps the parsed output type and transformed value', () => {
    expect(parsedCount).toBe(7)
  })

  it('drops one malformed optional value and reports its actual field', () => {
    expect(collectSalvageDrops(() => schema.parse({ count: 'invalid' }))).toEqual({
      value: { count: undefined },
      droppedPaths: ['count'],
      droppedCount: 1
    })
  })

  it('does not report missing optional data as corruption', () => {
    expect(collectSalvageDrops(() => schema.parse({}))).toEqual({
      value: {},
      droppedPaths: [],
      droppedCount: 0
    })
  })

  it('treats a thrown parser as invalid data and reports it', () => {
    const field = salvagedOptional('count', {
      safeParse: () => {
        throw new Error('invalid input')
      }
    })
    expect(collectSalvageDrops(() => field.parse('anything'))).toEqual({
      value: undefined,
      droppedPaths: ['count'],
      droppedCount: 1
    })
  })
})
