import { createHash } from 'node:crypto'
import { chmod, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import { WorkflowCommandEvidenceSchema } from '../../shared/task-workflow/workflow-command-evidence'
import { WorkflowNativeOutcomeAssetSchema } from '../../shared/task-workflow/workflow-native-outcome'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'
import { TaskCodeSnapshotStore } from './task-code-snapshot'
import { TaskWorkflowOutcomeStore } from './task-workflow-outcome-store'
import { workflowOutcomeFixture } from './task-workflow-outcome.test-fixture'
import {
  withTaskWorkflowAssetPublication,
  writeTaskWorkflowAsset
} from './task-workflow-outcome-assets'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture(status: 'succeeded' | 'failed' = 'succeeded') {
  const f = await workflowOutcomeFixture({ status })
  roots.push(f.root)
  const collectCommands = vi.fn(async () =>
    WorkflowCommandEvidenceSchema.parse({
      kind: 'available',
      producer: taskCodeSnapshotProducer(f.record),
      sessionId: 'session:outcome',
      journalCursor: { epoch: 'journal:unit', sequence: 5 },
      turnItemId: agentJournalItemKey({ provider: 'orca', clientMessageId: 'turn:unit' }),
      turnRevision: 1,
      turnSequence: 2,
      providerTurnId: 'turn:unit',
      turnOutcome: 'success',
      commands: []
    })
  )
  const snapshots = new TaskCodeSnapshotStore(f.directory),
    capture = vi.spyOn(snapshots, 'capture'),
    outcomes = new TaskWorkflowOutcomeStore({
      directory: f.directory,
      artifacts: f.artifacts,
      snapshots,
      collectCommands
    })
  return { ...f, collectCommands, capture, snapshots, outcomes }
}
describe('immutable workflow outcome assets under the original host result', () => {
  it('rejects an invalid publication name before filesystem or producer work', async () => {
    const f = await fixture(),
      publish = vi.fn(async () => true)
    for (const filename of ['../outside.json', `workflow-outcome-${'f'.repeat(64)}.json\n`]) {
      await expect(
        withTaskWorkflowAssetPublication(
          { directory: f.directory, filename, assertCurrent: () => undefined },
          publish
        )
      ).rejects.toThrow('INVALID_REQUEST')
    }
    expect(publish).not.toHaveBeenCalled()
  })
  it('serializes concurrent asset writes and refuses replacement without damaging the original', async () => {
    const f = await fixture(),
      filename = `workflow-evidence-${'f'.repeat(64)}.json`,
      options = {
        directory: f.directory,
        filename,
        bytes: Buffer.from('{"sealed":true}'),
        maximum: 1024,
        assertCurrent: () => undefined
      }
    await Promise.all(Array.from({ length: 8 }, () => writeTaskWorkflowAsset(options)))
    await expect(
      writeTaskWorkflowAsset({ ...options, bytes: Buffer.from('{"sealed":false}') })
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(await readFile(join(f.directory, filename), 'utf8')).toBe('{"sealed":true}')
    expect(
      (await readdir(f.directory)).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock'))
    ).toEqual([])
  })
  it('publishes exact artifacts, stopped producer and developer snapshot without treating empty commands as approval', async () => {
    const f = await fixture(),
      asset = await f.outcomes.read(f.record, () => undefined)
    expect(WorkflowNativeOutcomeAssetSchema.safeParse(asset).success).toBe(true)
    expect(asset.outcome.producer).toEqual(taskCodeSnapshotProducer(f.record))
    expect(asset.outcome.context).toEqual(f.command.workflowContext)
    expect(asset.outcome.artifacts.map((item) => item.version.artifactRef)).toEqual(
      f.record.result!.artifactRefs
    )
    expect(asset.outcome.codeVersion?.kind).toBe('snapshot')
    expect(asset.version.digest).toBe(
      createHash('sha256').update(JSON.stringify(asset.outcome)).digest('hex')
    )
    expect(asset).not.toHaveProperty('decision')
    const commands = asset.outcome.commands
    if (commands.kind !== 'available') {
      throw new Error('Missing command evidence')
    }
    expect(
      await f.outcomes.readCommands(f.record, commands.artifact.artifactRef, () => undefined)
    ).toMatchObject({ kind: 'available', commands: [] })
    await writeFile(join(f.record.workspace.executionPath, 'app.js'), 'late manual edit')
    expect(await f.outcomes.read(f.record, () => undefined)).toEqual(asset)
    expect(f.collectCommands).toHaveBeenCalledTimes(1)
    expect(f.capture).toHaveBeenCalledTimes(1)
  })
  it('retains failed execution and diagnostic code instead of publishing success', async () => {
    const f = await fixture('failed'),
      asset = await f.outcomes.read(f.record, () => undefined)
    expect(asset.outcome.producer.status).toBe('failed')
    expect(asset.outcome.codeVersion?.kind).toBe('snapshot')
  })
  it('captures code and journal once for concurrent first publication requests', async () => {
    const f = await fixture()
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => f.outcomes.read(f.record, () => undefined))
    )
    expect(
      outcomes.every(
        (outcome) =>
          canonicalAgentSessionDigest(outcome) === canonicalAgentSessionDigest(outcomes[0]!)
      )
    ).toBe(true)
    expect(f.capture).toHaveBeenCalledTimes(1)
    expect(f.collectCommands).toHaveBeenCalledTimes(1)
  })
  it('bounds escaped JSON command evidence before copying developer code', async () => {
    const f = await fixture(),
      facts = await f.collectCommands()
    if (facts.kind !== 'available') {
      throw new Error('Missing command fixture')
    }
    facts.journalCursor.sequence = 512
    facts.commands = Array.from({ length: 100 }, (_, index) => ({
      itemId: agentJournalItemKey({ provider: 'orca', clientMessageId: `command:${index}` }),
      revision: 1,
      callId: `call:${index}`,
      sequence: index + 3,
      command: 'node --test',
      cwd: '/workspace',
      state: 'completed',
      exitCode: 0,
      output: {
        head: '\u0001'.repeat(16 * 1024),
        byteLength: 16 * 1024,
        digest: 'a'.repeat(64),
        truncated: false
      }
    }))
    f.collectCommands.mockResolvedValueOnce(facts)
    await expect(f.outcomes.read(f.record, () => undefined)).rejects.toThrow('CAPACITY_EXCEEDED')
    expect(f.capture).not.toHaveBeenCalled()
  })
  it('publishes explicit unavailable journal evidence without inventing commands', async () => {
    const f = await fixture()
    f.collectCommands.mockResolvedValueOnce({ kind: 'unavailable', reason: 'journal_unavailable' })
    expect((await f.outcomes.read(f.record, () => undefined)).outcome.commands).toEqual({
      kind: 'unavailable',
      reason: 'journal_unavailable'
    })
    await expect(
      f.outcomes.readCommands(f.record, `artifact:${'a'.repeat(64)}`, () => undefined)
    ).rejects.toThrow('FORBIDDEN')
  })
  it.each([
    'running',
    'cancelled',
    'not-stopped',
    'writers-live',
    'missing-context',
    'missing-docker',
    'missing-session'
  ] as const)('refuses %s before collecting command facts or a code snapshot', async (boundary) => {
    const f = await fixture(),
      record = structuredClone(f.record)
    if (boundary === 'running') {
      Object.assign(record, { result: null, status: 'running' })
    }
    if (boundary === 'cancelled') {
      record.cancellationKey = 'cancel:unit'
    }
    if (boundary === 'not-stopped') {
      record.result!.stopProof.evidenceKind = 'not_started'
    }
    if (boundary === 'writers-live') {
      Object.assign(record.result!.stopProof, { writersFenced: false })
    }
    if (boundary === 'missing-context') {
      delete record.command.workflowContext
    }
    if (boundary === 'missing-docker') {
      delete record.dockerIdentity
    }
    if (boundary === 'missing-session') {
      record.launch!.outcome = { kind: 'terminal', handle: 'unit' }
    }
    await expect(f.outcomes.read(record, () => undefined)).rejects.toThrow()
    expect(f.collectCommands).not.toHaveBeenCalled()
    expect(f.capture).not.toHaveBeenCalled()
  })
  it('refuses a forged command producer instead of sealing foreign evidence', async () => {
    const f = await fixture(),
      facts = await f.collectCommands()
    if (facts.kind !== 'available') {
      throw new Error('Missing command fixture')
    }
    facts.producer.task.runId = 'run:foreign'
    f.collectCommands.mockResolvedValueOnce(facts)
    await expect(f.outcomes.read(f.record, () => undefined)).rejects.toThrow('REVISION_CONFLICT')
  })
  it('keeps authority guards live across collection and refuses revoked writes', async () => {
    const f = await fixture()
    let revoked = false
    f.collectCommands.mockImplementationOnce(async () => {
      revoked = true
      return { kind: 'unavailable', reason: 'journal_unavailable' }
    })
    await expect(
      f.outcomes.read(f.record, () => {
        if (revoked) {
          throw new Error('revoked')
        }
      })
    ).rejects.toThrow('revoked')
    expect(f.capture).not.toHaveBeenCalled()
  })
  it('rejects tampered metadata and a replaced command blob on repeated reads', async () => {
    const f = await fixture(),
      asset = await f.outcomes.read(f.record, () => undefined),
      filename = (await readdir(f.directory)).find((name) => name.startsWith('workflow-outcome-'))!
    const original = await readFile(join(f.directory, filename)),
      modified = JSON.parse(original.toString('utf8'))
    modified.outcome.context.employeeRef = 'employee:foreign'
    await chmod(join(f.directory, filename), 0o600)
    await writeFile(join(f.directory, filename), JSON.stringify(modified))
    await expect(f.outcomes.read(f.record, () => undefined)).rejects.toThrow('OUTCOME_UNKNOWN')
    await writeFile(join(f.directory, filename), original)
    const commands = asset.outcome.commands
    if (commands.kind !== 'available') {
      throw new Error('Missing command fixture')
    }
    await chmod(join(f.directory, `workflow-evidence-${commands.artifact.digest}.json`), 0o600)
    await writeFile(join(f.directory, `workflow-evidence-${commands.artifact.digest}.json`), '{}')
    await expect(
      f.outcomes.readCommands(f.record, commands.artifact.artifactRef, () => undefined)
    ).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('requires exact command artifact membership for the same original result', async () => {
    const f = await fixture()
    await f.outcomes.read(f.record, () => undefined)
    await expect(
      f.outcomes.readCommands(
        f.record,
        `artifact:${canonicalAgentSessionDigest({ foreign: true })}`,
        () => undefined
      )
    ).rejects.toThrow('FORBIDDEN')
  })
})
