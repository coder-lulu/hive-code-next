import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  taskExecutionCapabilityRefusal,
  TaskExecutionCapabilitiesSchema
} from './task-execution-capabilities'
import {
  TASK_ENFORCEMENT_CAPABILITY,
  TASK_STOP_PROOF_CAPABILITY,
  TASK_WORKSPACE_CLAIM_CAPABILITY
} from './task-execution-primitives'
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

describe('cancellation capability boundaries', () => {
  const controlled = TaskExecutionStartSchema.parse({
    ...vectors.examples.start,
    requiredCapabilities: [TASK_ENFORCEMENT_CAPABILITY],
    executionPolicy: {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'policy:controlled',
      executionPolicyRevision: 'policy:1',
      enforcementEvidenceRef: 'proof:controlled'
    }
  })
  const initialHost = TaskExecutionCapabilitiesSchema.parse(vectors.examples.capability)
  const host = {
    ...initialHost,
    capabilities: initialHost.capabilities.filter(
      (capability) => capability !== TASK_ENFORCEMENT_CAPABILITY
    )
  }
  it('admits cancellation without new-launch enforcement and keeps default start strict', () => {
    expect(taskExecutionCapabilityRefusal(controlled, host, 'cancel')).toBeNull()
    expect(taskExecutionCapabilityRefusal(controlled, host)).toBe('task_capability_unavailable')
  })
  it.each([TASK_STOP_PROOF_CAPABILITY, TASK_WORKSPACE_CLAIM_CAPABILITY, 'task.extra-required.v1'])(
    'does not waive another required cancellation capability: %s',
    (capability) => {
      const value = {
        ...controlled,
        requiredCapabilities: [...controlled.requiredCapabilities, capability]
      }
      const current = {
        ...host,
        capabilities: host.capabilities.filter((entry) => entry !== capability)
      }
      expect(taskExecutionCapabilityRefusal(value, current, 'cancel')).toBe(
        'task_capability_unavailable'
      )
    }
  )
  it.each([
    { runtimeRecordId: 'runtime:foreign' },
    { ownershipEpoch: controlled.ownershipEpoch + 1 }
  ])('rejects foreign runtime ownership during cancellation: %j', (identity) => {
    expect(
      taskExecutionCapabilityRefusal(controlled, { ...host, ...identity }, 'cancel')
    ).not.toBeNull()
  })
  it('preserves the required snapshot coverage during cancellation', () => {
    expect(
      taskExecutionCapabilityRefusal(
        { ...controlled, ...vectors.examples.resources },
        { ...host, resourceCoverage: [] },
        'cancel'
      )
    ).toBe('task_coverage_unavailable')
  })
})

describe('task boundary failure handling', () => {
  it('refuses a malformed command without throwing a validation exception', () => {
    expect(taskExecutionCapabilityRefusal(null, vectors.examples.capability)).toBe(
      'task_command_invalid'
    )
  })

  it.each([null, { ...vectors.examples.capability, protocolVersion: 2 }])(
    'refuses a missing or incompatible capability response',
    (host) => {
      expect(taskExecutionCapabilityRefusal(vectors.examples.start, host)).toBe(
        'task_capability_unavailable'
      )
    }
  )

  it('does not look up evidence for malformed commands', async () => {
    const readHostReceipt = vi.fn()
    expect(
      await taskExecutionEvidenceRefusal({
        command: null,
        receipt: activation,
        operationCallerKey: vectors.operationCallerKey,
        readHostReceipt
      })
    ).toBe('task_command_invalid')
    expect(readHostReceipt).not.toHaveBeenCalled()
  })

  it.each(['caller\u0000spoof', 'caller\n'])(
    'refuses malformed caller identity %j before reading host storage',
    async (operationCallerKey) => {
      const readHostReceipt = vi.fn()
      expect(
        await taskExecutionEvidenceRefusal({
          command,
          receipt: activation,
          operationCallerKey,
          readHostReceipt
        })
      ).toBe('task_identity_invalid')
      expect(readHostReceipt).not.toHaveBeenCalled()
    }
  )

  it('verifies an asynchronously read durable receipt', async () => {
    expect(
      await taskExecutionEvidenceRefusal({
        command,
        receipt: activation,
        operationCallerKey: vectors.operationCallerKey,
        readHostReceipt: async () => activation
      })
    ).toBeNull()
  })

  it.each(['sync', 'async'])('refuses a %s host-store failure without rejecting', async (mode) => {
    const readHostReceipt = () => {
      const error = new Error('host store unavailable')
      if (mode === 'sync') {
        throw error
      }
      const rejected = Promise.reject(error)
      void rejected.catch(() => undefined)
      return rejected
    }
    expect(
      await taskExecutionEvidenceRefusal({
        command,
        receipt: activation,
        operationCallerKey: vectors.operationCallerKey,
        readHostReceipt
      })
    ).toBe('task_evidence_unavailable')
  })
})

describe('oversized task collections', () => {
  it.each([33, 100_000])('rejects %s capabilities before visiting elements', (count) => {
    const requiredCapabilities: unknown[] = []
    requiredCapabilities.length = count
    Object.defineProperty(requiredCapabilities, 0, {
      get: () => {
        throw new Error('oversized elements must not be visited')
      }
    })
    expect(
      TaskExecutionStartSchema.safeParse({ ...vectors.examples.start, requiredCapabilities })
        .success
    ).toBe(false)
  })

  it.each([257, 100_000])('rejects %s loaded references before visiting elements', (count) => {
    const loadedRefs: unknown[] = []
    loadedRefs.length = count
    Object.defineProperty(loadedRefs, 0, {
      get: () => {
        throw new Error('oversized elements must not be visited')
      }
    })
    expect(TaskResourceActivationSchema.safeParse({ ...activation, loadedRefs }).success).toBe(
      false
    )
  })
})
