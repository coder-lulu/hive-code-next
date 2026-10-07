import { describe, expect, it } from 'vitest'
import { LocalTaskClient } from './local-task-client'
import {
  outcomeAccessFixture,
  outcomeByteVersion
} from './task-workflow-outcome-access.test-fixture'
import { WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES } from '../../shared/task-workflow/workflow-native-outcome'

function clientFor(value: unknown) {
  return new LocalTaskClient({
    baseUrl: 'http://127.0.0.1:12345',
    secret: 'a'.repeat(43),
    fetch: async () => new Response(JSON.stringify(value))
  })
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseKeys)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toReversed()
        .map(([key, item]) => [key, reverseKeys(item)])
    )
  }
  return value
}

describe('strict workflow outcome client metadata and byte digests', () => {
  it('normalizes response key order before checking the same publisher bytes', async () => {
    const f = await outcomeAccessFixture(1)
    expect(await clientFor(reverseKeys(f.asset)).workflowOutcome(f.query)).toEqual(f.asset)
    expect(await clientFor(reverseKeys(f.commands)).workflowCommands(f.commandQuery)).toEqual(
      f.commands
    )
  })
  it.each([
    'runtimeRecordId',
    'ownershipEpoch',
    'executionId',
    'executionEpoch',
    'commandFingerprint'
  ] as const)('rejects a foreign outcome %s even with its correct content SHA', async (key) => {
    const f = await outcomeAccessFixture(),
      asset = structuredClone(f.asset)
    Object.assign(asset.outcome.producer, {
      [key]:
        typeof asset.outcome.producer[key] === 'number'
          ? 99
          : key === 'commandFingerprint'
            ? 'f'.repeat(64)
            : 'foreign:identity'
    })
    asset.version = outcomeByteVersion(asset.outcome)
    await expect(clientFor(asset).workflowOutcome(f.query)).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it.each([
    'runtimeRecordId',
    'ownershipEpoch',
    'executionId',
    'executionEpoch',
    'commandFingerprint'
  ] as const)('rejects foreign command %s even with its correct content SHA', async (key) => {
    const f = await outcomeAccessFixture(),
      commands = structuredClone(f.commands)
    if (commands.kind !== 'available') {
      throw new Error('Fixture commands missing')
    }
    Object.assign(commands.producer, {
      [key]:
        typeof commands.producer[key] === 'number'
          ? 99
          : key === 'commandFingerprint'
            ? 'f'.repeat(64)
            : 'foreign:identity'
    })
    const artifactRef = outcomeByteVersion(commands).artifactRef
    await expect(
      clientFor(commands).workflowCommands({ ...f.commandQuery, artifactRef })
    ).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('rejects outcome content tampering and an inconsistent artifact reference', async () => {
    const f = await outcomeAccessFixture(),
      asset = structuredClone(f.asset)
    asset.outcome.producer.outcomeRef = 'outcome:tampered'
    await expect(clientFor(asset).workflowOutcome(f.query)).rejects.toThrow('OUTCOME_UNKNOWN')
    asset.version = { ...f.asset.version, artifactRef: `artifact:${'f'.repeat(64)}` }
    await expect(clientFor(asset).workflowOutcome(f.query)).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('rejects changed command content, extra metadata and unavailable evidence', async () => {
    const f = await outcomeAccessFixture(1),
      commands = structuredClone(f.commands)
    if (commands.kind !== 'available') {
      throw new Error('Fixture commands missing')
    }
    commands.commands[0].command = 'pnpm deploy'
    await expect(clientFor(commands).workflowCommands(f.commandQuery)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    await expect(
      clientFor({ ...f.commands, proof: true }).workflowCommands(f.commandQuery)
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    await expect(
      clientFor({ kind: 'unavailable', reason: 'journal_unavailable' }).workflowCommands(
        f.commandQuery
      )
    ).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('keeps all client response limits bounded by their route', async () => {
    const f = await outcomeAccessFixture()
    await expect(
      clientFor({ padding: 'x'.repeat(64 * 1024) }).workflowOutcome(f.query)
    ).rejects.toThrow('SERVICE_UNAVAILABLE')
    await expect(clientFor({ padding: 'x'.repeat(64 * 1024) }).capabilities()).rejects.toThrow(
      'SERVICE_UNAVAILABLE'
    )
    await expect(
      clientFor({ padding: 'x'.repeat(WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES) }).workflowCommands(
        f.commandQuery
      )
    ).rejects.toThrow('SERVICE_UNAVAILABLE')
  })
  it('rejects excessive JSON structure on the command path before schema parsing', async () => {
    const f = await outcomeAccessFixture()
    await expect(
      clientFor(Array.from({ length: 20_000 }, () => 0)).workflowCommands(f.commandQuery)
    ).rejects.toThrow('SERVICE_UNAVAILABLE')
  })
})
