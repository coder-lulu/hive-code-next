import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workflowCodeInputFixture } from './task-workflow-code-input.test-fixture'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { createWorkflowTaskCodeRestorer } from './task-workflow-code-input'
import { restoreLocalTaskWorkspace } from './local-task-workspace-recovery'
import { taskDockerFixture } from './task-docker-boundary.test-fixture'
import {
  probeTaskDockerEnforcement,
  assertTaskDockerEnforcementCommand
} from './task-docker-enforcement'
import { TASK_TEST_NOW, taskCapabilities, taskStopEvidence } from './task-execution.test-fixture'
import { TaskArtifactIndex, taskResultManifestName } from './task-artifact-index'
import { createLocalTaskAuthorizer } from './local-task-authority'
import { TaskExecutionHost } from './task-execution-host'
import { taskExecutionIdentity } from './task-execution-record'

const roots: string[] = [],
  issuers: LocalTaskBindingIssuer[] = []
afterEach(async () => {
  await Promise.all(issuers.splice(0).map((issuer) => issuer.close()))
  closeTestJournalHostDatabases()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const f = await workflowCodeInputFixture()
  roots.push(f.root)
  const docker = await taskDockerFixture(join(f.root, 'docker'))
  const account = {
    accountId: f.options.owner.accountId,
    authorityId: 'authority:unit',
    sessionGeneration: 1,
    accessToken: 'synthetic-unit-token',
    sessionExpiresAt: TASK_TEST_NOW + 120_000
  }
  const folders = new Map<string, { folderPath: string; isArchived: boolean; connectionId: null }>()
  const options = {
    directory: join(f.root, 'issuer'),
    operationCallerKey: f.options.operationCallerKey,
    now: () => TASK_TEST_NOW,
    currentRuntime: () => f.options.owner,
    currentAccount: () => account,
    resolveSource: async () => ({ path: f.project, assertCurrent: () => undefined }),
    readExecution: f.options.readExecution,
    restoreCodeInput: createWorkflowTaskCodeRestorer({
      snapshots: f.options.snapshots,
      currentRuntime: () => f.options.owner,
      operationCallerKey: f.options.operationCallerKey,
      readExecution: f.options.readExecution,
      resolveSource: async () => ({ path: f.project, assertCurrent: () => undefined })
    }),
    registerWorkspace: async (path: string) => {
      const id = randomUUID()
      folders.set(id, { folderPath: path, isArchived: false, connectionId: null })
      return { workspaceId: `folder:${id}`, assertCurrent: () => undefined }
    },
    restoreWorkspace: async (workspace: Parameters<typeof restoreLocalTaskWorkspace>[0]) =>
      restoreLocalTaskWorkspace(workspace, {
        assertCurrent: () => undefined,
        getFolderWorkspace: (id) => folders.get(id)
      }),
    resolveEnforcement: () =>
      probeTaskDockerEnforcement({
        configuration: () => docker.options,
        owner: {
          runtimeRecordId: f.options.owner.runtimeRecordId,
          ownershipEpoch: f.options.owner.ownershipEpoch,
          executionAccountRef: f.view.team.company.ownerAccountRef
        },
        assertCurrent: docker.options.assertCurrent,
        run: docker.run
      })
  }
  const create = () => {
    const issuer = new LocalTaskBindingIssuer(options)
    issuers.push(issuer)
    return issuer
  }
  return { ...f, input: f.options.input, options, create }
}

describe('host workflow binding, fixed source and independent output integration', () => {
  it('refuses changed recovered code for execution while retaining original stop authority', async () => {
    const f = await fixture(),
      issuer = f.create(),
      binding = await issuer.issue(f.input),
      grant = issuer.resolveGrant(binding.command.authorizationRef)!
    const { record } = await f.store.tasks.admit({
      command: binding.command,
      operationCallerKey: f.options.operationCallerKey,
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    await issuer.close()
    await writeFile(join(grant.workspace.executionPath, 'app.ts'), 'unapproved replacement')
    const restarted = f.create(),
      recovered = await restarted.resolveBinding(
        binding.paperclipCompanyId,
        binding.command.task.runId,
        f.options.operationCallerKey,
        'recover'
      )
    expect(() => restarted.assertExecutionCurrent(record)).toThrow('OUTCOME_UNKNOWN')
    const authorize = createLocalTaskAuthorizer({
      ...f.options,
      resolveGrant: restarted.resolveGrant
    })
    const host = new TaskExecutionHost({
      store: f.store.tasks,
      authorize,
      authorizeEnforcement: async (command, action) => {
        if (action === 'start') {
          assertTaskDockerEnforcementCommand(command, await f.options.resolveEnforcement())
        }
      },
      now: f.options.now,
      capabilities: () => taskCapabilities(recovered.command),
      launch: async () => {
        throw new Error('Must not launch')
      },
      collect: async () => null,
      stop: async (current) => taskStopEvidence(current)
    })
    const cancelled = await host.cancel(
      {
        ...taskExecutionIdentity(recovered.command),
        kind: 'execution.cancel',
        task: recovered.command.task,
        idempotencyKey: 'cancel:fixed-code-recovery',
        commandFingerprint: recovered.commandFingerprint,
        authorizationRef: recovered.command.authorizationRef,
        authorizationRevision: recovered.command.authorizationRevision,
        expiresAt: recovered.command.expiresAt,
        reason: 'user_requested'
      },
      { operationCallerKey: f.options.operationCallerKey }
    )
    expect(cancelled.result?.status).toBe('cancelled')
    expect(cancelled.result?.stopProof.evidenceKind).toBe('not_started')
  })
  it('issues and restores the same native binding with code/output guards and an unchanged deadline', async () => {
    const f = await fixture(),
      issuer = f.create()
    await writeFile(join(f.project, 'app.ts'), 'a newer unapproved project version')
    const binding = await issuer.issue(f.input),
      grant = issuer.resolveGrant(binding.command.authorizationRef)!
    expect(binding.command.workflowContext).toEqual(f.input.workflowContext)
    expect(binding.command.executionDeadlineAt).toBe(f.record.command.executionDeadlineAt)
    expect(await readFile(join(grant.workspace.executionPath, 'app.ts'), 'utf8')).toContain(
      'acceptedVersion = 1'
    )
    expect(grant.workspace.outputDirectory?.path).not.toContain(`${grant.workspace.executionPath}/`)
    expect(grant.input).toContain('/outputs/.hive-task-result-')
    await f.store.tasks.admit({
      command: binding.command,
      operationCallerKey: f.options.operationCallerKey,
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    await issuer.close()
    const restarted = f.create(),
      recovered = await restarted.resolveBinding(
        binding.paperclipCompanyId,
        binding.command.task.runId,
        f.options.operationCallerKey,
        'recover'
      )
    expect(recovered.commandFingerprint).toBe(binding.commandFingerprint)
    expect(recovered.command.workflowContext).toEqual(binding.command.workflowContext)
    const recoveredGrant = restarted.resolveGrant(recovered.command.authorizationRef)!
    expect(recoveredGrant.actions).not.toContain('start')
    const output = recoveredGrant.workspace.outputDirectory!
    await rename(output.path, `${output.path}-original`)
    await mkdir(output.path)
    expect(() => recoveredGrant.assertCurrent()).toThrow('FORBIDDEN')
  })
  it('reads only the tester output directory and refuses code paths in its artifact manifest', async () => {
    const f = await fixture(),
      issuer = f.create(),
      binding = await issuer.issue(f.input),
      grant = issuer.resolveGrant(binding.command.authorizationRef)!
    const { record } = await f.store.tasks.admit({
      command: binding.command,
      operationCallerKey: f.options.operationCallerKey,
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    const output = grant.workspace.outputDirectory!,
      manifestPath = join(output.path, taskResultManifestName(record.commandFingerprint))
    await writeFile(join(output.path, 'test-report.md'), 'actual unit report')
    const manifest = {
      schemaVersion: 1,
      executionId: record.command.executionId,
      commandFingerprint: record.commandFingerprint,
      status: 'succeeded',
      artifacts: ['test-report.md']
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    const artifacts = new TaskArtifactIndex(join(f.root, 'reports')),
      candidate = await artifacts.collect(record, 'success')
    expect(await artifacts.read(candidate!.outcomeRef, candidate!.artifactRefs[0]!)).toEqual({
      name: 'test-report.md',
      text: 'actual unit report'
    })
    await writeFile(manifestPath, JSON.stringify({ ...manifest, artifacts: ['../app.ts'] }))
    await expect(artifacts.collect(record, 'success')).rejects.toThrow('FORBIDDEN')
  })
})
