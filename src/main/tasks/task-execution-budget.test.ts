import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskExecutionAcceptedSchema } from '../../shared/task-execution/task-execution-receipts'
import { taskCommand, TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskExecutionDeadline } from './task-execution-budget'

function accepted(recordedAt = new Date(TASK_TEST_NOW).toISOString()) {
  const vectors = JSON.parse(
    readFileSync(resolve('integration/contracts/v1/test-vectors.json'), 'utf8')
  )
  return TaskExecutionAcceptedSchema.parse({ ...vectors.examples.accepted, recordedAt })
}

describe('fixed original Task execution budget', () => {
  it('keeps the thirty-minute execution deadline anchored to acceptance across renewable command expiries', () => {
    const record = { accepted: accepted(), command: taskCommand() }
    const initial = taskExecutionDeadline(record)
    expect(initial).toBe(TASK_TEST_NOW + 30 * 60_000)
    expect(initial).toBeGreaterThan(Date.parse(record.command.expiresAt))
    record.command.expiresAt = new Date(TASK_TEST_NOW + 120_000).toISOString()
    expect(taskExecutionDeadline(record)).toBe(initial)
  })
  it('uses the original accepted time rather than the current clock', () => {
    const first = taskExecutionDeadline({ accepted: accepted() })
    const later = taskExecutionDeadline({
      accepted: accepted(new Date(TASK_TEST_NOW + 5000).toISOString())
    })
    expect(later - first).toBe(5000)
  })
  it('refuses a malformed acceptance timestamp rather than disabling the execution deadline', () => {
    const receipt = accepted()
    receipt.recordedAt = 'invalid-timestamp'
    expect(() => taskExecutionDeadline({ accepted: receipt })).toThrow('INVALID_REQUEST')
  })
})
