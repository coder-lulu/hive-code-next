import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { TaskExecutionStartSchema } from './task-execution-command'
import { taskExecutionEvidenceRefusal } from './task-execution-evidence'
import { computeTaskExecutionFingerprint } from './task-execution-fingerprint'
import { TaskResourceActivationSchema } from './task-execution-receipts'

const vectors = z
  .object({
    operationCallerKey: z.string(),
    examples: z.record(z.string(), z.record(z.string(), z.unknown()))
  })
  .parse(JSON.parse(readFileSync(resolve('integration/contracts/v1/test-vectors.json'), 'utf8')))
const command = TaskExecutionStartSchema.parse({
  ...vectors.examples.start,
  ...vectors.examples.resources
})
const activation = TaskResourceActivationSchema.parse({
  ...vectors.examples.activation,
  commandFingerprint: computeTaskExecutionFingerprint(command, vectors.operationCallerKey)
})

describe('resource evidence binding before host lookup', () => {
  it.each([
    ['snapshotRef', 'snapshot:other', 'task_resource_binding_mismatch'],
    ['snapshotDigest', '0'.repeat(64), 'task_resource_binding_mismatch'],
    ['resolverVersion', 'resolver:other', 'task_resource_binding_mismatch'],
    ['observedCoverage', 'managed_only', 'task_coverage_insufficient']
  ])('refuses invalid %s without reading host storage', async (field, value, refusal) => {
    const receipt = { ...activation, [field]: value }
    const readHostReceipt = vi.fn(async () => receipt)
    expect(
      await taskExecutionEvidenceRefusal({
        command,
        receipt,
        operationCallerKey: vectors.operationCallerKey,
        readHostReceipt
      })
    ).toBe(refusal)
    expect(readHostReceipt).not.toHaveBeenCalled()
  })

  it('refuses unsolicited resource evidence without reading host storage', async () => {
    const receipt = {
      ...activation,
      commandFingerprint: computeTaskExecutionFingerprint(
        vectors.examples.start,
        vectors.operationCallerKey
      )
    }
    const readHostReceipt = vi.fn(async () => receipt)
    expect(
      await taskExecutionEvidenceRefusal({
        command: vectors.examples.start,
        receipt,
        operationCallerKey: vectors.operationCallerKey,
        readHostReceipt
      })
    ).toBe('task_resource_not_requested')
    expect(readHostReceipt).not.toHaveBeenCalled()
  })

  it('reads valid bound evidence exactly once by receipt id', async () => {
    const readHostReceipt = vi.fn(async () => activation)
    expect(
      await taskExecutionEvidenceRefusal({
        command,
        receipt: activation,
        operationCallerKey: vectors.operationCallerKey,
        readHostReceipt
      })
    ).toBeNull()
    expect(readHostReceipt).toHaveBeenCalledExactlyOnceWith(activation.receiptId)
  })
})
