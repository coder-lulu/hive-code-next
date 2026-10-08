import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { WorkflowSchemas, taskWorkflowJsonSchema } from './workflow-contract'
import { WorkflowPlanProposalSchema, workflowPlanProposalRefusal } from './workflow-plan-proposal'

const vectors = z
  .strictObject({
    example: WorkflowPlanProposalSchema,
    cases: z.array(
      z.strictObject({
        name: z.string(),
        path: z.array(z.union([z.string(), z.number().int().min(0)])).min(1),
        value: z.unknown(),
        expected: z.string()
      })
    )
  })
  .parse(
    JSON.parse(
      readFileSync(
        resolve('integration/contracts/workflow-v1/plan-proposal-test-vectors.json'),
        'utf8'
      )
    )
  )

function patch(original: unknown, path: (string | number)[], value: unknown): unknown {
  if (!path.length) {
    return value
  }
  const [key, ...rest] = path
  if (Array.isArray(original)) {
    if (typeof key !== 'number') {
      throw new Error('Invalid synthetic array path')
    }
    const result = [...original]
    result[key] = patch(result[key], rest, value)
    return result
  }
  const record = z.record(z.string(), z.unknown()).parse(original)
  return { ...record, [key]: patch(record[key], rest, value) }
}

describe('published plan proposal vectors', () => {
  it('publishes the current validator alongside the existing workflow schema', () => {
    const published = JSON.parse(
      readFileSync(resolve('integration/contracts/workflow-v1/task-workflow.schema.json'), 'utf8')
    )
    expect(published).toEqual(taskWorkflowJsonSchema())
    expect(WorkflowSchemas.PlanProposal.safeParse(vectors.example).success).toBe(true)
    expect(workflowPlanProposalRefusal(vectors.example)).toBeNull()
  })

  it.each([
    ['', false],
    [' ', false],
    ['\t\r\n', false],
    ['\u00A0\u3000\uFEFF', false],
    ['\uD800', false],
    ['\uDC00', false],
    ['a'.repeat(2049), false],
    ['a'.repeat(2048), true],
    ['😀'.repeat(2048), true],
    [' x ', true],
    ['中', true]
  ])('keeps published text constraints consistent for %j', (value, expected) => {
    const published = JSON.parse(
      readFileSync(resolve('integration/contracts/workflow-v1/task-workflow.schema.json'), 'utf8')
    )
    const fields = published.$defs.PlanProposal.properties.tasks.items.properties
    for (const schema of [fields.title, fields.acceptance.items]) {
      const constraints = z
        .object({
          minLength: z.literal(1),
          maxLength: z.number().int(),
          allOf: z.array(z.object({ pattern: z.string() })).length(2)
        })
        .parse(schema)
      const characters = [...value].length
      const accepted =
        characters >= constraints.minLength &&
        characters <= constraints.maxLength &&
        constraints.allOf.every(({ pattern }) => new RegExp(pattern).test(value))
      expect(accepted).toBe(expected)
    }
    for (const field of ['title', 'acceptance']) {
      const changed = patch(
        vectors.example,
        ['tasks', 0, field],
        field === 'title' ? value : [value]
      )
      expect(WorkflowPlanProposalSchema.safeParse(changed).success).toBe(expected)
    }
  })

  for (const vector of vectors.cases) {
    it(vector.name, () => {
      const value = patch(vectors.example, vector.path, vector.value)
      expect(workflowPlanProposalRefusal(value)).toBe(vector.expected)
      expect(WorkflowPlanProposalSchema.safeParse(value).success).toBe(false)
    })
  }
})
