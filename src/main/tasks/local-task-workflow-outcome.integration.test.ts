import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import { WorkflowCommandEvidenceSchema } from '../../shared/task-workflow/workflow-command-evidence'
import {
  WorkflowNativeOutcomeAssetSchema,
  WorkflowNativeOutcomeSchema
} from '../../shared/task-workflow/workflow-native-outcome'
import { workflowOutcomeFixture } from './task-workflow-outcome.test-fixture'
import { TaskCodeSnapshotStore } from './task-code-snapshot'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'
import { TaskWorkflowOutcomeStore } from './task-workflow-outcome-store'
import { TaskExecutionHost } from './task-execution-host'
import { TaskExecutionError } from './task-execution-error'
import { taskExecutionIdentity, type TaskExecutionRecord } from './task-execution-record'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { startLocalTaskTransport } from './local-task-transport'
import { LocalTaskClient } from './local-task-client'
import { taskCapabilities, TASK_TEST_NOW } from './task-execution.test-fixture'

const transports: Awaited<ReturnType<typeof startLocalTaskTransport>>[] = []
afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()))
})
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

async function fixture() {
  const f = await workflowOutcomeFixture()
  const snapshots = new TaskCodeSnapshotStore(f.directory),
    capture = vi.spyOn(snapshots, 'capture')
  // Synthetic empty facts and enforcement exercise local transport/storage only.
  const collectCommands = vi.fn(async (record: TaskExecutionRecord) => {
    const producer = taskCodeSnapshotProducer(record)
    return WorkflowCommandEvidenceSchema.parse({
      kind: 'available',
      producer,
      sessionId: producer.sessionRef,
      journalCursor: { epoch: 'journal:unit-integration', sequence: 1 },
      turnItemId: agentJournalItemKey({
        provider: 'orca',
        clientMessageId: 'turn:unit-integration'
      }),
      turnRevision: 1,
      turnSequence: 1,
      providerTurnId: 'turn:unit-integration',
      turnOutcome: 'success',
      commands: []
    })
  })
  const outcomes = new TaskWorkflowOutcomeStore({
    directory: f.directory,
    artifacts: f.artifacts,
    snapshots,
    collectCommands
  })
  let ownerCurrent = true,
    callerCurrent = true
  const assertOwner = () => {
    if (!ownerCurrent) {
      throw new TaskExecutionError('FORBIDDEN')
    }
  }
  const assertCaller = () => {
    if (!callerCurrent) {
      throw new TaskExecutionError('FORBIDDEN')
    }
  }
  const unavailable = vi.fn(async () => {
    throw new Error('Read must not call launch, stop or collection ports')
  })
  const host = new TaskExecutionHost({
    store: f.store.tasks,
    workflowOutcomes: outcomes,
    capabilities: () => taskCapabilities(f.command),
    now: () => TASK_TEST_NOW,
    authorizeEnforcement: vi.fn(async () => undefined),
    authorize: vi.fn(async () => ({
      workspace: f.record.workspace,
      input: 'Private unit input.',
      assertCurrent: assertOwner
    })),
    launch: unavailable,
    stop: unavailable,
    collect: unavailable
  })
  const credential = createLocalTaskServiceCredential(f.record.operationCallerKey)
  const transport = await startLocalTaskTransport({
    host,
    capabilities: () => taskCapabilities(f.command),
    authenticate: (bearer) => {
      const caller = credential.authenticate(bearer)
      return caller ? { ...caller, assertCurrent: assertCaller } : null
    }
  })
  transports.push(transport)
  const client = new LocalTaskClient({ baseUrl: transport.baseUrl, secret: credential.secret })
  const query = {
    ...taskExecutionIdentity(f.command),
    commandFingerprint: f.record.commandFingerprint,
    authorizationRef: f.command.authorizationRef,
    authorizationRevision: f.command.authorizationRevision,
    expiresAt: f.command.expiresAt,
    kind: 'workflow.outcome.read' as const
  }
  return {
    ...f,
    host,
    outcomes,
    snapshots,
    capture,
    collectCommands,
    unavailable,
    transport,
    credential,
    client,
    query,
    revokeOwner: () => {
      ownerCurrent = false
    },
    revokeCaller: () => {
      callerCurrent = false
    }
  }
}

describe('actual local record and filesystem outcome transport integration', () => {
  it('reads sealed developer code, original artifact bytes and normalized command SHA through authenticated HTTP', async () => {
    const f = await fixture(),
      asset = await f.client.workflowOutcome(f.query)
    expect(WorkflowNativeOutcomeAssetSchema.safeParse(asset).success).toBe(true)
    expect(asset.outcome.producer).toEqual(taskCodeSnapshotProducer(f.record))
    expect(asset.outcome.context).toEqual(f.command.workflowContext)
    expect(asset.version.digest).toBe(
      sha(JSON.stringify(WorkflowNativeOutcomeSchema.parse(asset.outcome)))
    )
    expect(asset.version.artifactRef).toBe(`artifact:${asset.version.digest}`)
    const persisted = await readFile(
      join(
        f.directory,
        `workflow-outcome-${canonicalAgentSessionDigest(asset.outcome.producer)}.json`
      )
    )
    expect(WorkflowNativeOutcomeAssetSchema.parse(JSON.parse(persisted.toString('utf8')))).toEqual(
      asset
    )
    const code = asset.outcome.codeVersion
    if (code?.kind !== 'snapshot') {
      throw new Error('Missing sealed developer snapshot')
    }
    const source = await f.snapshots.readSource(code, f.record)
    expect(await readFile(join(source.path, 'app.js'), 'utf8')).toBe('export const value = 1\n')
    expect(source.treeDigest).toBe(code.treeDigest)
    const artifact = asset.outcome.artifacts[0],
      original = await f.artifacts.read(f.record.result!.outcomeRef, artifact.version.artifactRef)
    expect(original).toEqual({ name: 'report.md', text: 'Original result report\n' })
    expect(artifact.version.digest).toBe(sha(original.text))
    const description = asset.outcome.commands
    if (description.kind !== 'available') {
      throw new Error('Missing unit command asset')
    }
    const commandQuery = {
      ...f.query,
      kind: 'workflow.commands.read',
      artifactRef: description.artifact.artifactRef
    }
    const commands = await f.client.workflowCommands(commandQuery)
    expect(commands.commands).toEqual([])
    expect(commands.producer).toEqual(asset.outcome.producer)
    const bytes = await readFile(
      join(f.directory, `workflow-evidence-${description.artifact.digest}.json`)
    )
    expect(sha(bytes)).toBe(description.artifact.digest)
    expect(sha(JSON.stringify(WorkflowCommandEvidenceSchema.parse(commands)))).toBe(
      description.artifact.digest
    )
    await writeFile(join(f.record.workspace.canonicalPath, 'app.js'), 'late manual project edit\n')
    await writeFile(join(f.record.workspace.executionPath, 'app.js'), 'late execution copy edit\n')
    expect(await f.client.workflowOutcome(f.query)).toEqual(asset)
    expect(await f.client.workflowCommands(commandQuery)).toEqual(commands)
    expect(await readFile(join(source.path, 'app.js'), 'utf8')).toBe('export const value = 1\n')
    expect(f.capture).toHaveBeenCalledTimes(1)
    expect(f.collectCommands).toHaveBeenCalledTimes(1)
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it('refuses a command artifact from outside the original stopped outcome', async () => {
    const f = await fixture()
    await f.client.workflowOutcome(f.query)
    await expect(
      f.client.workflowCommands({
        ...f.query,
        kind: 'workflow.commands.read',
        artifactRef: `artifact:${'f'.repeat(64)}`
      })
    ).rejects.toThrow('FORBIDDEN')
    expect(f.unavailable).not.toHaveBeenCalled()
  })
  it.each(['revokeOwner', 'revokeCaller'] as const)(
    'refuses %s before serving already sealed assets',
    async (revoke) => {
      const f = await fixture(),
        asset = await f.client.workflowOutcome(f.query)
      const commands = asset.outcome.commands
      if (commands.kind !== 'available') {
        throw new Error('Missing unit command asset')
      }
      f[revoke]()
      await expect(f.client.workflowOutcome(f.query)).rejects.toThrow('FORBIDDEN')
      await expect(
        f.client.workflowCommands({
          ...f.query,
          kind: 'workflow.commands.read',
          artifactRef: commands.artifact.artifactRef
        })
      ).rejects.toThrow('FORBIDDEN')
      expect(f.capture).toHaveBeenCalledTimes(1)
      expect(f.collectCommands).toHaveBeenCalledTimes(1)
      expect(f.unavailable).not.toHaveBeenCalled()
    }
  )
})
