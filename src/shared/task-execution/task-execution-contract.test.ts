import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { TaskExecutionStartSchema } from './task-execution-command'
import { TaskExecutionSchemas, taskExecutionJsonSchema } from './task-execution-contract'
import { computeTaskExecutionFingerprint } from './task-execution-fingerprint'

const ObjectValue = z.record(z.string(), z.unknown())
const vectors = z
  .object({
    operationCallerKey: z.string(),
    expectedFingerprints: z.object({ static: z.string(), snapshot: z.string() }),
    examples: z.record(z.string(), ObjectValue),
    validationCases: z.array(
      z.object({
        name: z.string(),
        schema: z.enum(Object.keys(TaskExecutionSchemas)),
        example: z.string(),
        extend: z.string().optional(),
        patch: ObjectValue.optional(),
        remove: z.array(z.string()).optional(),
        valid: z.boolean()
      })
    ),
    fingerprintCases: z.array(z.object({ name: z.string(), patch: ObjectValue, same: z.boolean() }))
  })
  .parse(JSON.parse(readFileSync(resolve('integration/contracts/v1/test-vectors.json'), 'utf8')))

describe('task execution contract vectors', () => {
  for (const vector of vectors.validationCases) {
    it(vector.name, () => {
      const value = {
        ...vectors.examples[vector.example],
        ...(vector.extend ? vectors.examples[vector.extend] : {}),
        ...vector.patch
      }
      for (const key of vector.remove ?? []) {
        delete value[key]
      }
      const schema = Object.entries(TaskExecutionSchemas).find(([name]) => name === vector.schema)
      expect(schema?.[1].safeParse(value).success).toBe(vector.valid)
    })
  }

  it('keeps the published JSON schema generated from the validators', () => {
    const published = JSON.parse(
      readFileSync(resolve('integration/contracts/v1/task-execution.schema.json'), 'utf8')
    )
    expect(published).toEqual(taskExecutionJsonSchema())
  })

  it.each(['principal', 'command', 'env', 'cwd', 'operationCallerKey'])(
    'rejects nested task field %s instead of stripping it',
    (key) => {
      const start = TaskExecutionStartSchema.parse(vectors.examples.start)
      expect(
        TaskExecutionStartSchema.safeParse({ ...start, task: { ...start.task, [key]: 'unsafe' } })
          .success
      ).toBe(false)
    }
  )
})

describe('task requirement fingerprint', () => {
  const command = { ...vectors.examples.start, ...vectors.examples.resources }
  const fingerprint = computeTaskExecutionFingerprint(command, vectors.operationCallerKey)

  it('matches the fixed independently computed cross-language SHA-256 vectors', () => {
    expect(fingerprint).toBe(vectors.expectedFingerprints.snapshot)
    expect(
      computeTaskExecutionFingerprint(vectors.examples.start, vectors.operationCallerKey)
    ).toBe(vectors.expectedFingerprints.static)
  })

  for (const vector of vectors.fingerprintCases) {
    it(vector.name, () => {
      const changed = computeTaskExecutionFingerprint(
        { ...command, ...vector.patch },
        vectors.operationCallerKey
      )
      expect(changed === fingerprint).toBe(vector.same)
    })
  }

  it('partitions by authenticated caller', () => {
    expect(computeTaskExecutionFingerprint(command, 'account-runtime:another')).not.toBe(
      fingerprint
    )
  })

  it('uses the same digest for reordered properties and capability sets', () => {
    const first = { ...command, requiredCapabilities: ['task.z.v1', 'task.a.v1'] }
    const reordered = Object.fromEntries(Object.entries(first).toReversed())
    reordered.requiredCapabilities = ['task.a.v1', 'task.z.v1', 'task.a.v1']
    expect(computeTaskExecutionFingerprint(first, vectors.operationCallerKey)).toBe(
      computeTaskExecutionFingerprint(reordered, vectors.operationCallerKey)
    )
  })

  it('rejects a malformed caller key before calculating a digest', () => {
    expect(() => computeTaskExecutionFingerprint(command, 'caller\u0000spoof')).toThrow()
  })
})
