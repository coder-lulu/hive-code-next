import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { LocalTaskBindingInputSchema, localTaskBindingKey } from './local-task-binding-file'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import {
  taskCommand,
  taskCapabilities,
  taskTestDirectory,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'
import {
  assertTaskDockerEnforcementCommand,
  probeTaskDockerEnforcement
} from './task-docker-enforcement'
import { taskDockerFixture } from './task-docker-boundary.test-fixture'
import { createLocalTaskAuthorizer } from './local-task-authority'
import { TaskExecutionHost } from './task-execution-host'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import type { TaskExecutionStart } from '../../shared/task-execution/task-execution-command'
import type { TaskExecutionAction } from './task-execution-ports'
import { createTaskCodexEvidence } from './task-codex-evidence'
import { TASK_ENFORCEMENT_CAPABILITY } from '../../shared/task-execution/task-execution-primitives'

const roots: string[] = []
const issuers: LocalTaskBindingIssuer[] = []
afterEach(async () => {
  await Promise.all(issuers.splice(0).map((issuer) => issuer.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await taskTestDirectory()
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'source.txt'), 'source')
  const records = await openTestAgentSessionRecordStore(join(root, 'records'))
  const docker = await taskDockerFixture()
  const account = {
    accountId: 'account',
    authorityId: 'authority',
    sessionGeneration: 1,
    accessToken: 'fixture',
    sessionExpiresAt: TASK_TEST_NOW + 120_000
  }
  const currentRuntime = () => ({
    runtimeRecordId: 'runtime:one',
    ownershipEpoch: 1,
    accountId: account.accountId
  })
  const options = {
    directory: join(root, 'tasks'),
    operationCallerKey: 'trusted-local:runtime',
    currentAccount: () => account,
    currentRuntime,
    resolveSource: async () => ({ path: source, assertCurrent: () => undefined }),
    registerWorkspace: vi.fn(async () => ({
      workspaceId: 'folder:managed',
      assertCurrent: () => undefined
    })),
    readExecution: records.tasks.get.bind(records.tasks),
    restoreWorkspace: async () => ({ assertCurrent: () => undefined }),
    now: () => TASK_TEST_NOW,
    resolveEnforcement: () =>
      probeTaskDockerEnforcement({
        configuration: () => docker.options,
        owner: {
          runtimeRecordId: currentRuntime().runtimeRecordId,
          ownershipEpoch: currentRuntime().ownershipEpoch,
          executionAccountRef: `account:${createHash('sha256').update(JSON.stringify(account.accountId)).digest('hex')}`
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
  const input = {
    paperclipCompanyId: 'company:one',
    paperclipAgentId: 'agent:codex',
    task: { ...taskCommand().task, spaceId: 'company:one' },
    workspaceSelector: 'id:source',
    input: 'Write report.md.'
  }
  return { options, records, docker, create, input }
}

describe('private controlled Case policy issuance', () => {
  it('preserves the personal input bound and rejects caller policy evidence', async () => {
    const h = await fixture()
    expect(
      LocalTaskBindingInputSchema.safeParse({ ...h.input, input: 'a'.repeat(48_001) }).success
    ).toBe(false)
    expect(LocalTaskBindingInputSchema.safeParse({ ...h.input, executionPolicy: {} }).success).toBe(
      false
    )
    const binding = await h.create().issue(h.input)
    expect(binding.command.executionPolicy.trustMode).toBe('trusted_personal_preview')
    expect(h.docker.run).not.toHaveBeenCalled()
  })

  it('issues an enforced policy only after actual installed Docker proof and fences its grant', async () => {
    const h = await fixture()
    const issuer = h.create()
    const binding = await issuer.issue({ ...h.input, executionMode: 'enforced_autonomous' })
    expect(binding.command.executionPolicy.trustMode).toBe('enforced_autonomous')
    expect(binding.command.policyRevision).toBe('docker-local-linux:1')
    expect(binding.command.requiredCapabilities).toContain('task.enforcement.v1')
    expect(h.docker.run).toHaveBeenCalledTimes(3)
    const grant = issuer.resolveGrant(binding.command.authorizationRef)
    expect(grant).toBeDefined()
    h.docker.revoke()
    expect(() => grant?.assertCurrent()).toThrow('revoked')
  })

  it('refuses controlled issuance without Docker before writing intent or registering a workspace', async () => {
    const h = await fixture()
    h.docker.run.mockRejectedValue(new Error('unavailable'))
    await expect(
      h.create().issue({ ...h.input, executionMode: 'enforced_autonomous' })
    ).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    expect(h.options.registerWorkspace).not.toHaveBeenCalled()
    await expect(
      readFile(
        join(
          h.options.directory,
          'bindings',
          `${localTaskBindingKey(h.input.paperclipCompanyId, h.input.task.runId)}.intent.json`
        )
      )
    ).rejects.toThrow()
  })

  it('admits only the issued policy through the authenticated host gate', async () => {
    const h = await fixture()
    const issuer = h.create()
    const binding = await issuer.issue({ ...h.input, executionMode: 'enforced_autonomous' })
    const launch = vi.fn(async () => ({ ...TASK_TEST_LAUNCH, worktreeId: 'folder:managed' }))
    const host = new TaskExecutionHost({
      store: h.records.tasks,
      now: h.options.now,
      capabilities: () => taskCapabilities(binding.command),
      authorize: createLocalTaskAuthorizer({ ...h.options, resolveGrant: issuer.resolveGrant }),
      authorizeEnforcement: async (command) => {
        assertTaskDockerEnforcementCommand(command, await h.options.resolveEnforcement())
      },
      launch,
      collect: async () => null,
      stop: async () => null
    })
    const caller = { operationCallerKey: h.options.operationCallerKey }
    await host.start(binding.command, caller)
    await host.drain()
    expect(launch).toHaveBeenCalledOnce()
    await expect(
      host.start(
        {
          ...binding.command,
          executionPolicy: {
            trustMode: 'enforced_autonomous',
            executionPolicyRef: 'docker-local-linux',
            executionPolicyRevision: '1',
            enforcementEvidenceRef: `docker-enforcement:${'0'.repeat(64)}`
          }
        },
        caller
      )
    ).rejects.toThrow('FORBIDDEN')
    expect(launch).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'cancels an issued controlled binding after deadline or lost enforcement: %s',
    async (missingEnforcement) => {
      const h = await fixture()
      const issuer = h.create()
      const binding = await issuer.issue({
        ...h.input,
        executionMode: 'enforced_autonomous',
        executionDeadlineAt: new Date(TASK_TEST_NOW + 1000).toISOString()
      })
      const now = () => TASK_TEST_NOW + (missingEnforcement ? 500 : 2000)
      const launch = vi.fn(async () => TASK_TEST_LAUNCH)
      const enforcement = vi.fn(
        async (_command: TaskExecutionStart, action: TaskExecutionAction) => {
          if (action === 'start') {
            throw new Error('CAPABILITY_UNAVAILABLE')
          }
          expect(action).toBe('cancel')
        }
      )
      const host = new TaskExecutionHost({
        store: h.records.tasks,
        now,
        capabilities: () => {
          const capabilities = taskCapabilities(binding.command)
          return {
            ...capabilities,
            capabilities: capabilities.capabilities.filter(
              (capability) => !missingEnforcement || capability !== TASK_ENFORCEMENT_CAPABILITY
            )
          }
        },
        resolveStart: () => binding.command,
        authorize: createLocalTaskAuthorizer({
          ...h.options,
          now,
          resolveGrant: issuer.resolveGrant
        }),
        authorizeEnforcement: enforcement,
        launch,
        collect: async () => null,
        stop: createTaskCodexEvidence(join(h.options.directory, 'artifacts')).stop
      })
      const caller = { operationCallerKey: h.options.operationCallerKey }
      const command = binding.command
      if (missingEnforcement) {
        await expect(host.start(command, caller)).rejects.toThrow('CAPABILITY_UNAVAILABLE')
        expect(h.records.tasks.get(command)).toBeNull()
      }
      const result = await host.cancel(
        {
          protocolVersion: 1,
          kind: 'execution.cancel',
          runtimeRecordId: command.runtimeRecordId,
          ownershipEpoch: command.ownershipEpoch,
          executionId: command.executionId,
          executionEpoch: command.executionEpoch,
          authorizationRef: command.authorizationRef,
          authorizationRevision: command.authorizationRevision,
          expiresAt: command.expiresAt,
          task: command.task,
          commandFingerprint: computeTaskExecutionFingerprint(
            binding.command,
            caller.operationCallerKey
          ),
          idempotencyKey: 'cancel:controlled-prestart',
          reason: 'user_requested'
        },
        caller
      )
      await host.drain()
      expect(result.result?.status).toBe('cancelled')
      expect(result.result?.stopProof.evidenceKind).toBe('not_started')
      expect(launch).not.toHaveBeenCalled()
      expect(enforcement).toHaveBeenCalled()
    }
  )

  it('bounds the expanded private prompt and restores JSON-escaped inputs larger than 512KiB', async () => {
    const h = await fixture()
    const input = LocalTaskBindingInputSchema.parse({
      ...h.input,
      executionMode: 'enforced_autonomous',
      input: '\u0001'.repeat(128_000)
    })
    expect(
      LocalTaskBindingInputSchema.safeParse({ ...input, input: `${input.input}a` }).success
    ).toBe(false)
    const issuer = h.create()
    const binding = await issuer.issue(input)
    const grant = issuer.resolveGrant(binding.command.authorizationRef)
    if (!grant) {
      throw new Error('Missing host grant')
    }
    await h.records.tasks.admit({
      command: binding.command,
      operationCallerKey: h.options.operationCallerKey,
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    await issuer.close()
    const key = localTaskBindingKey(input.paperclipCompanyId, input.task.runId)
    expect(
      (await readFile(join(h.options.directory, 'bindings', `${key}.intent.json`))).length
    ).toBeGreaterThan(512 * 1024)
    expect(await h.create().restoreBindings(h.records.tasks.listActive())).toEqual({
      restored: 1,
      unavailable: 0
    })
  })

  it('restores the exact enforced policy and rejects a persisted private-mode downgrade', async () => {
    const h = await fixture()
    const issuer = h.create()
    const input = LocalTaskBindingInputSchema.parse({
      ...h.input,
      executionMode: 'enforced_autonomous'
    })
    const binding = await issuer.issue(input)
    const grant = issuer.resolveGrant(binding.command.authorizationRef)
    if (!grant) {
      throw new Error('Missing host grant')
    }
    await h.records.tasks.admit({
      command: binding.command,
      operationCallerKey: h.options.operationCallerKey,
      workspace: grant.workspace,
      now: TASK_TEST_NOW,
      validate: grant.assertCurrent
    })
    await issuer.close()
    const recovered = h.create()
    expect(await recovered.restoreBindings(h.records.tasks.listActive())).toEqual({
      restored: 1,
      unavailable: 0
    })
    expect(
      (
        await recovered.resolveBinding(
          input.paperclipCompanyId,
          input.task.runId,
          h.options.operationCallerKey,
          'recover'
        )
      ).command.executionPolicy
    ).toEqual(binding.command.executionPolicy)
    const intentPath = join(
      h.options.directory,
      'bindings',
      `${localTaskBindingKey(input.paperclipCompanyId, input.task.runId)}.intent.json`
    )
    const intent = JSON.parse(await readFile(intentPath, 'utf8'))
    delete intent.input.executionMode
    intent.fingerprint = createHash('sha256').update(JSON.stringify(intent.input)).digest('hex')
    await writeFile(intentPath, JSON.stringify(intent))
    const bindingPath = intentPath.replace('.intent.json', '.json')
    const stored = JSON.parse(await readFile(bindingPath, 'utf8'))
    stored.fingerprint = intent.fingerprint
    await writeFile(bindingPath, JSON.stringify(stored))
    expect(await h.create().restoreBindings(h.records.tasks.listActive())).toEqual({
      restored: 0,
      unavailable: 1
    })
  })
})
