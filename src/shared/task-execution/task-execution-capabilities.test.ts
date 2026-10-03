import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AGENT_LAUNCH_REPLAY_RUNTIME_CAPABILITY,
  AGENT_LAUNCH_RUNTIME_CAPABILITY,
  RUNTIME_CAPABILITIES
} from '../protocol-version'
import {
  TaskExecutionCapabilitiesSchema,
  taskExecutionCapabilityRefusal
} from './task-execution-capabilities'
import { TaskExecutionStartSchema } from './task-execution-command'
import { TaskExecutionResultSchema, TaskResourceActivationSchema } from './task-execution-receipts'
import { taskExecutionEvidenceRefusal } from './task-execution-evidence'
import { computeTaskExecutionFingerprint } from './task-execution-fingerprint'
import {
  TASK_ENFORCEMENT_CAPABILITY,
  TASK_RESOURCE_SNAPSHOT_CAPABILITY
} from './task-execution-primitives'

const vectors = z
  .object({
    operationCallerKey: z.string(),
    examples: z.record(z.string(), z.record(z.string(), z.unknown()))
  })
  .parse(JSON.parse(readFileSync(resolve('integration/contracts/v1/test-vectors.json'), 'utf8')))
const command = TaskExecutionStartSchema.parse(vectors.examples.start)
const host = TaskExecutionCapabilitiesSchema.parse(vectors.examples.capability)
const resourceCommand = TaskExecutionStartSchema.parse({
  ...command,
  ...vectors.examples.resources
})

describe('task capability admission', () => {
  it('admits the complete declared capability set', () => {
    expect(taskExecutionCapabilityRefusal(command, host)).toBeNull()
  })

  it('rejects the existing launch capabilities alone until a TaskExecutionHost exists', () => {
    expect(
      taskExecutionCapabilityRefusal(command, {
        ...host,
        capabilities: [AGENT_LAUNCH_RUNTIME_CAPABILITY, AGENT_LAUNCH_REPLAY_RUNTIME_CAPABILITY]
      })
    ).toBe('task_capability_unavailable')
  })

  it('probes the current shipped Runtime capability catalog without advertising unfinished work', () => {
    expect(
      taskExecutionCapabilityRefusal(command, { ...host, capabilities: [...RUNTIME_CAPABILITIES] })
    ).toBe('task_capability_unavailable')
  })

  for (const missing of host.capabilities) {
    it(`refuses without ${missing}`, () => {
      expect(
        taskExecutionCapabilityRefusal(command, {
          ...host,
          capabilities: host.capabilities.filter((capability) => capability !== missing)
        })
      ).toBe('task_capability_unavailable')
    })
  }

  it('rejects unknown required capabilities', () => {
    expect(
      taskExecutionCapabilityRefusal({ ...command, requiredCapabilities: ['task.future.v9'] }, host)
    ).toBe('task_capability_unavailable')
  })

  it.each([
    ['runtimeRecordId', 'runtime:other', 'task_runtime_mismatch'],
    ['ownershipEpoch', 8, 'task_ownership_epoch_mismatch']
  ])('refuses a different %s', (field, value, reason) => {
    expect(taskExecutionCapabilityRefusal(command, { ...host, [field]: value })).toBe(reason)
  })

  it('keeps team execution out of personal preview', () => {
    expect(
      taskExecutionCapabilityRefusal(
        { ...command, ownerScope: { kind: 'teamSpace', teamSpaceRef: 'team:001' } },
        host
      )
    ).toBe('task_enforcement_required')
  })

  it('requires an enforcement reference and the host enforcement capability', () => {
    const executionPolicy = {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'policy:team',
      executionPolicyRevision: 'revision:001'
    }
    expect(TaskExecutionStartSchema.safeParse({ ...command, executionPolicy }).success).toBe(false)
    const enforced = {
      ...command,
      executionPolicy: { ...executionPolicy, enforcementEvidenceRef: 'enforcement:001' }
    }
    expect(taskExecutionCapabilityRefusal(enforced, host)).toBe('task_capability_unavailable')
    expect(
      taskExecutionCapabilityRefusal(enforced, {
        ...host,
        capabilities: [...host.capabilities, TASK_ENFORCEMENT_CAPABILITY]
      })
    ).toBeNull()
  })

  const resourceHost = {
    ...host,
    capabilities: [...host.capabilities, TASK_RESOURCE_SNAPSHOT_CAPABILITY],
    resourceCoverage: ['effective_set_verified'],
    manifestVersions: ['1'],
    resolverVersions: ['native-pi:0.85.1']
  }

  it('admits exactly supported snapshot requirements', () => {
    expect(taskExecutionCapabilityRefusal(resourceCommand, resourceHost)).toBeNull()
  })

  it('accepts stronger effective-set verification for a managed-only requirement', () => {
    expect(
      taskExecutionCapabilityRefusal(
        { ...resourceCommand, requiredCoverage: 'managed_only' },
        resourceHost
      )
    ).toBeNull()
  })

  it.each([
    ['resourceCoverage', ['managed_only'], 'task_coverage_unavailable'],
    ['manifestVersions', ['2'], 'task_manifest_unsupported'],
    ['resolverVersions', ['native-pi:next'], 'task_resolver_unsupported']
  ])('refuses unsupported %s without dropping the resource group', (field, value, reason) => {
    expect(
      taskExecutionCapabilityRefusal(resourceCommand, { ...resourceHost, [field]: value })
    ).toBe(reason)
  })
})

describe('host-recorded task evidence', () => {
  const activation = TaskResourceActivationSchema.parse({
    ...vectors.examples.activation,
    commandFingerprint: computeTaskExecutionFingerprint(resourceCommand, vectors.operationCallerKey)
  })
  const check = (receipt: unknown, recorded: unknown = activation) =>
    taskExecutionEvidenceRefusal({
      command: resourceCommand,
      receipt,
      operationCallerKey: vectors.operationCallerKey,
      readHostReceipt: () => recorded
    })

  it('accepts only a receipt confirmed by the execution host', async () => {
    expect(await check(activation)).toBeNull()
    expect(await check(activation, null)).toBe('task_evidence_unverified')
  })

  it('rejects forged loaded resources even with a real receipt id', async () => {
    expect(await check({ ...activation, loadedRefs: ['skill:forged'] })).toBe(
      'task_evidence_unverified'
    )
  })

  it.each([
    ['executionId', 'execution:other'],
    ['executionEpoch', 2],
    ['runtimeRecordId', 'runtime:other'],
    ['ownershipEpoch', 8],
    ['commandFingerprint', '0'.repeat(64)]
  ])('rejects a mismatched %s', async (field, value) => {
    expect(await check({ ...activation, [field]: value })).toBe('task_evidence_binding_mismatch')
  })

  it('rejects a recorded receipt for the wrong snapshot', async () => {
    const wrong = { ...activation, snapshotDigest: 'd'.repeat(64) }
    expect(await check(wrong, wrong)).toBe('task_resource_binding_mismatch')
  })

  it('does not elevate managed-only evidence to effective-set coverage', async () => {
    const partial = { ...activation, observedCoverage: 'managed_only' }
    expect(await check(partial, partial)).toBe('task_coverage_insufficient')
  })

  it('does not accept preparation or accepted receipts as loading evidence', async () => {
    expect(await check(vectors.examples.preparation)).toBe('task_evidence_invalid')
    expect(await check(vectors.examples.accepted)).toBe('task_evidence_invalid')
  })

  it('requires a durable terminal result with stopped writers and settled tools', async () => {
    const result = TaskExecutionResultSchema.parse({
      ...vectors.examples.result,
      commandFingerprint: activation.commandFingerprint
    })
    expect(await check(result, result)).toBeNull()
    expect(await check(result, null)).toBe('task_evidence_unverified')
    for (const change of [
      { evidenceKind: 'not_started' },
      { managedToolsSettled: false },
      { writersFenced: false }
    ]) {
      expect(
        await check({ ...result, stopProof: { ...result.stopProof, ...change } }, result)
      ).toBe('task_evidence_invalid')
    }
  })
})
