import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServerAdapter } from './paperclip-runtime-adapter'
import { taskAdapterFixture } from './task-adapter.test-fixture'
import { createLocalTaskAuthorizer, type LocalTaskGrant } from './local-task-authority'
import { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { TaskExecutionError } from './task-execution-error'
import {
  taskCommand,
  taskTestDirectory,
  TASK_TEST_CALLER,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

let fixture: Awaited<ReturnType<typeof taskAdapterFixture>> | undefined
let issuer: LocalTaskBindingIssuer | undefined
let issuerDirectory = ''
afterEach(async () => {
  await fixture?.close()
  await issuer?.close()
  if (issuerDirectory) {
    await rm(issuerDirectory, { recursive: true, force: true })
  }
  fixture = undefined
  issuer = undefined
  issuerDirectory = ''
  vi.restoreAllMocks()
})

async function slowFixture() {
  fixture = await taskAdapterFixture()
  const current = fixture
  let now = TASK_TEST_NOW
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  current.ports.waitTimeoutMs = 120_000
  current.deps.collect = vi.fn(async () => ({ outcomeRef: 'outcome:test', artifactRefs: [] }))
  const originalStart = current.client.start.bind(current.client)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const start = vi.spyOn(current.client, 'start').mockImplementation(async (...args) => {
    const accepted = await originalStart(...args)
    entered.resolve()
    await release.promise
    return accepted
  })
  const cancel = vi.spyOn(current.client, 'cancel')
  return {
    current,
    entered,
    release,
    start,
    cancel,
    advance: (milliseconds: number) => {
      now = TASK_TEST_NOW + milliseconds
    }
  }
}

describe('original grant renewal while the single start acknowledgement is pending', () => {
  it('refreshes the actual issuer canonical grant without expiring an already admitted source guard', async () => {
    issuerDirectory = await taskTestDirectory()
    const source = join(issuerDirectory, 'source')
    await mkdir(source)
    await writeFile(join(source, 'input.txt'), 'Synthetic source')
    let now = TASK_TEST_NOW
    const account = {
      accountId: 'account:one',
      authorityId: 'authority:one',
      sessionGeneration: 1,
      sessionExpiresAt: TASK_TEST_NOW + 300_000,
      accessToken: 'synthetic-only'
    }
    const runtime = {
      accountId: account.accountId,
      runtimeRecordId: 'runtime:one',
      ownershipEpoch: 1
    }
    issuer = new LocalTaskBindingIssuer({
      directory: join(issuerDirectory, 'bindings'),
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey,
      currentAccount: () => account,
      currentRuntime: () => runtime,
      resolveSource: async () => ({ path: source, assertCurrent: () => undefined }),
      registerWorkspace: async () => ({
        workspaceId: 'synthetic:copy',
        assertCurrent: () => undefined
      }),
      readExecution: () => null,
      restoreWorkspace: async () => ({ assertCurrent: () => undefined }),
      now: () => now
    })
    const owner = issuer
    const command = taskCommand()
    const input = {
      paperclipCompanyId: 'company:test',
      paperclipAgentId: 'agent:test',
      task: { ...command.task, spaceId: 'company:test' },
      workspaceSelector: 'id:source',
      input: 'Synthetic input'
    }
    const binding = await owner.issue(input)
    const grant = owner.resolveGrant(binding.command.authorizationRef)
    if (!grant) {
      throw new Error('Original canonical grant is required')
    }
    const authorize = createLocalTaskAuthorizer({
      currentAccount: () => account,
      currentRuntime: () => runtime,
      resolveGrant: owner.resolveGrant,
      now: () => now
    })
    const admitted = await authorize(TASK_TEST_CALLER, binding.command, 'start')
    now += 50_000
    const renewed = await owner.resolveBinding(
      input.paperclipCompanyId,
      input.task.runId,
      TASK_TEST_CALLER.operationCallerKey,
      'execute'
    )
    expect(owner.resolveGrant(binding.command.authorizationRef)).toBe(grant)
    expect(renewed.commandFingerprint).toBe(binding.commandFingerprint)
    expect(grant.validUntil).toBe(TASK_TEST_NOW + 110_000)
    now += 11_000
    expect(admitted.assertCurrent()).toBeUndefined()
    await expect(authorize(TASK_TEST_CALLER, binding.command, 'start')).rejects.toThrow('FORBIDDEN')
  })
  it('renews before the first observe and keeps the original slow launch guard live past sixty seconds', async () => {
    const h = await slowFixture()
    const { current } = h
    const account = {
      accountId: 'account:one',
      authorityId: 'authority:one',
      sessionGeneration: 1,
      sessionExpiresAt: TASK_TEST_NOW + 300_000,
      accessToken: 'synthetic-only'
    }
    const grant: LocalTaskGrant = {
      command: current.binding.command,
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey,
      workspace: {
        hostId: 'local',
        workspaceId: TASK_TEST_LAUNCH.worktreeId,
        canonicalPath: current.directory,
        executionPath: current.directory,
        isolation: 'managed_copy'
      },
      input: 'Synthetic input',
      accountId: account.accountId,
      authorityId: account.authorityId,
      sessionGeneration: account.sessionGeneration,
      runtimeOwnershipEpoch: current.binding.command.ownershipEpoch,
      validUntil: Date.parse(current.binding.command.expiresAt),
      actions: ['start', 'observe', 'cancel', 'reconcile'],
      assertCurrent: () => undefined
    }
    current.deps.authorize = createLocalTaskAuthorizer({
      currentAccount: () => account,
      currentRuntime: () => ({
        accountId: account.accountId,
        runtimeRecordId: current.binding.command.runtimeRecordId,
        ownershipEpoch: current.binding.command.ownershipEpoch
      }),
      resolveGrant: (ref) => (ref === current.binding.command.authorizationRef ? grant : null),
      now: Date.now
    })
    const launchPending = Promise.withResolvers<void>()
    current.deps.launch = vi.fn(async (_record, authorization) => {
      await launchPending.promise
      authorization.assertCurrent()
      return TASK_TEST_LAUNCH
    })
    current.ports.resolveBinding = vi.fn(async () => {
      grant.validUntil = Date.now() + 60_000
      return {
        ...current.binding,
        command: { ...current.binding.command, expiresAt: new Date(grant.validUntil).toISOString() }
      }
    })
    const observe = vi.spyOn(current.client, 'observe')
    const execution = createServerAdapter(async () => current.ports).execute(current.context)
    try {
      await h.entered.promise
      h.advance(50_000)
      await vi.waitFor(() => expect(grant.validUntil).toBe(TASK_TEST_NOW + 110_000), {
        timeout: 1000
      })
      expect(observe).not.toHaveBeenCalled()
      h.advance(61_000)
      launchPending.resolve()
      h.release.resolve()
      const result = await execution
      expect(result.exitCode).toBe(0)
      expect(current.deps.launch).toHaveBeenCalledOnce()
      expect(h.start).toHaveBeenCalledOnce()
      expect(current.ports.resolveBinding).toHaveBeenCalledTimes(2)
    } finally {
      launchPending.resolve()
      h.release.resolve()
      await execution
    }
  })
  it('keeps renewal single flight and stops polling after start and terminal completion', async () => {
    const h = await slowFixture()
    const pendingRenewal = Promise.withResolvers<void>()
    let flights = 0
    let maximum = 0
    let calls = 0
    h.current.ports.resolveBinding = vi.fn(async () => {
      calls += 1
      if (calls > 1) {
        flights += 1
        maximum = Math.max(maximum, flights)
        await pendingRenewal.promise
        flights -= 1
      }
      return {
        ...h.current.binding,
        command: {
          ...h.current.binding.command,
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        }
      }
    })
    const execution = createServerAdapter(async () => h.current.ports).execute(h.current.context)
    try {
      await h.entered.promise
      h.advance(50_000)
      await vi.waitFor(() => expect(calls).toBe(2), { timeout: 1000 })
      await delay(35)
      expect(calls).toBe(2)
      expect(maximum).toBe(1)
      pendingRenewal.resolve()
      h.release.resolve()
      expect((await execution).exitCode).toBe(0)
      h.advance(200_000)
      await delay(35)
      expect(calls).toBe(2)
      expect(h.start).toHaveBeenCalledOnce()
    } finally {
      pendingRenewal.resolve()
      h.release.resolve()
      await execution
    }
  })
  it.each(['resolve', 'reject'] as const)(
    'cancels with the still-live original query on renewal failure and observes a late %s',
    async (late) => {
      const h = await slowFixture()
      let calls = 0
      h.current.ports.resolveBinding = vi.fn(async () => {
        if (++calls > 1) {
          throw new TaskExecutionError('SERVICE_UNAVAILABLE')
        }
        return h.current.binding
      })
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason)
      }
      process.on('unhandledRejection', onUnhandled)
      const execution = createServerAdapter(async () => h.current.ports).execute(h.current.context)
      try {
        await h.entered.promise
        h.advance(50_000)
        await vi.waitFor(() => expect(h.cancel).toHaveBeenCalledOnce(), { timeout: 1000 })
        const result = await execution
        expect(result.resultJson?.status).toBe('cancelled')
        expect(h.current.deps.stop).toHaveBeenCalledOnce()
        if (late === 'reject') {
          h.release.reject(new Error('Late start transport failure'))
        } else {
          h.release.resolve()
        }
        h.advance(200_000)
        await delay(35)
        expect(calls).toBe(2)
        expect(h.start).toHaveBeenCalledOnce()
        expect(unhandled).toEqual([])
      } finally {
        h.release.resolve()
        await execution
        process.off('unhandledRejection', onUnhandled)
      }
    }
  )
  it('bounds the pending start by the total execution budget and clears renewal after timeout', async () => {
    const h = await slowFixture()
    h.current.ports.waitTimeoutMs = 150
    const execution = createServerAdapter(async () => h.current.ports).execute(h.current.context)
    try {
      await h.entered.promise
      await vi.waitFor(() => expect(h.cancel).toHaveBeenCalledOnce(), { timeout: 1000 })
      const result = await execution
      expect(result.timedOut).toBe(true)
      expect(result.resultJson?.status).toBe('cancelled')
      const calls = vi.mocked(h.current.ports.resolveBinding).mock.calls.length
      h.advance(200_000)
      h.release.reject(new Error('Late timeout transport failure'))
      await delay(35)
      expect(h.current.ports.resolveBinding).toHaveBeenCalledTimes(calls)
      expect(h.start).toHaveBeenCalledOnce()
    } finally {
      h.release.resolve()
      await execution
    }
  })
  it('forwards cancellation while the already accepted start acknowledgement is pending', async () => {
    const h = await slowFixture()
    const execution = createServerAdapter(async () => h.current.ports).execute(h.current.context)
    try {
      await h.entered.promise
      h.current.controller.abort()
      await vi.waitFor(() => expect(h.cancel).toHaveBeenCalledOnce(), { timeout: 1000 })
      const result = await execution
      expect(result.resultJson?.status).toBe('cancelled')
      expect(h.current.deps.stop).toHaveBeenCalledOnce()
      h.release.resolve()
      expect(h.start).toHaveBeenCalledOnce()
    } finally {
      h.release.resolve()
      await execution
    }
  })
  it.each(['budget', 'abort'] as const)(
    'cleans up a pending renewal on %s without waiting for its late rejection',
    async (reason) => {
      const h = await slowFixture()
      h.current.binding.command.expiresAt = new Date(TASK_TEST_NOW + 10_050).toISOString()
      h.current.ports.waitTimeoutMs = 200
      const renewal = Promise.withResolvers<void>()
      let calls = 0
      h.current.ports.resolveBinding = vi.fn(async () => {
        if (++calls > 1) {
          await renewal.promise
        }
        return h.current.binding
      })
      const execution = createServerAdapter(async () => h.current.ports).execute(h.current.context)
      try {
        await h.entered.promise
        h.advance(50)
        await vi.waitFor(() => expect(calls).toBe(2), { timeout: 1000 })
        if (reason === 'abort') {
          h.current.controller.abort()
        }
        await vi.waitFor(() => expect(h.cancel).toHaveBeenCalledOnce(), { timeout: 1000 })
        const result = await execution
        expect(result.resultJson?.status).toBe('cancelled')
        expect(result.timedOut).toBe(reason === 'budget')
        renewal.reject(new Error('Late renewal transport failure'))
        h.release.reject(new Error('Late start transport failure'))
        await delay(35)
        expect(calls).toBe(2)
        expect(h.start).toHaveBeenCalledOnce()
      } finally {
        renewal.resolve()
        h.release.resolve()
        await execution
      }
    }
  )
})
