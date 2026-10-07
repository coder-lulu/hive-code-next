import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import {
  LocalTaskBindingInputSchema,
  localTaskBindingKey,
  readLocalTaskBinding
} from './local-task-binding-file'
import { localDeadlineBindingFixture } from './task-execution-deadline.test-fixture'
import { taskExecutionDeadline } from './task-execution-budget'
import { TASK_TEST_NOW } from './task-execution.test-fixture'

const deadlineAt = (offset: number) => new Date(TASK_TEST_NOW + offset).toISOString()
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

describe('private local execution deadline binding', () => {
  it('rejects deadlines on personal input before preparation and preserves personal execution behavior', async () => {
    const h = await localDeadlineBindingFixture()
    const issuer = h.create()
    expect(
      LocalTaskBindingInputSchema.safeParse({ ...h.input, executionDeadlineAt: deadlineAt(1000) })
        .success
    ).toBe(false)
    expect(() => issuer.issue({ ...h.input, executionDeadlineAt: deadlineAt(1000) })).toThrow()
    expect(h.options.resolveEnforcement).not.toHaveBeenCalled()
    expect(h.options.resolveSource).not.toHaveBeenCalled()
    expect(h.options.registerWorkspace).not.toHaveBeenCalled()
    const binding = await issuer.issue(h.input)
    expect(binding.command).not.toHaveProperty('executionDeadlineAt')
    expect(binding.command.executionPolicy.trustMode).toBe('trusted_personal_preview')
    expect(h.options.resolveEnforcement).not.toHaveBeenCalled()
  })

  it.each(['invalid', '2026-02-30T00:00:00.000Z'])(
    'refuses an invalid enforced deadline %s before any preparation effect',
    async (executionDeadlineAt) => {
      const h = await localDeadlineBindingFixture()
      const issuer = h.create()
      expect(() =>
        issuer.issue({
          ...h.input,
          executionMode: 'enforced_autonomous',
          executionDeadlineAt
        })
      ).toThrow()
      expect(h.options.resolveEnforcement).not.toHaveBeenCalled()
      expect(h.options.resolveSource).not.toHaveBeenCalled()
      expect(h.options.registerWorkspace).not.toHaveBeenCalled()
    }
  )

  it.each([undefined, deadlineAt(5000)])(
    'persists and recovers the original deadline %s without extending the lifetime budget',
    async (executionDeadlineAt) => {
      const h = await localDeadlineBindingFixture()
      const issuer = h.create()
      const input = LocalTaskBindingInputSchema.parse({
        ...h.input,
        executionMode: 'enforced_autonomous',
        ...(executionDeadlineAt === undefined ? {} : { executionDeadlineAt })
      })
      const binding = await issuer.issue(input)
      expect(binding.command.executionDeadlineAt).toBe(executionDeadlineAt)
      const grant = issuer.resolveGrant(binding.command.authorizationRef)
      if (!grant) {
        throw new Error('Missing original deadline fixture grant.')
      }
      const { record } = await h.records.tasks.admit({
        command: binding.command,
        operationCallerKey: h.options.operationCallerKey,
        workspace: grant.workspace,
        now: TASK_TEST_NOW,
        validate: grant.assertCurrent
      })
      const originalDeadline = taskExecutionDeadline(record)
      await issuer.close()
      h.setNow(TASK_TEST_NOW + 10_000)
      const reopened = await openTestAgentSessionRecordStore(h.recordsDirectory)
      const persisted = reopened.tasks.get(binding.command)
      expect(persisted).not.toBeNull()
      if (!persisted) {
        throw new Error('Missing durable deadline fixture execution.')
      }
      expect(taskExecutionDeadline(persisted)).toBe(originalDeadline)
      const fresh = h.create()
      expect(await fresh.restoreBindings(reopened.tasks.listActive())).toEqual({
        restored: 1,
        unavailable: 0
      })
      const recovered = await fresh.resolveBinding(
        input.paperclipCompanyId,
        input.task.runId,
        h.options.operationCallerKey,
        'recover'
      )
      expect(recovered.command.executionDeadlineAt).toBe(executionDeadlineAt)
      expect(recovered.command.operationId).toBe(binding.command.operationId)
      expect(recovered.commandFingerprint).toBe(binding.commandFingerprint)
      expect(recovered.command.expiresAt).not.toBe(binding.command.expiresAt)
      expect(
        taskExecutionDeadline({ accepted: persisted.accepted, command: recovered.command })
      ).toBe(originalDeadline)
    }
  )

  it.each([
    { commandDeadline: deadlineAt(5000), intentDeadline: deadlineAt(10_000) },
    { commandDeadline: deadlineAt(5000), intentDeadline: undefined },
    { commandDeadline: undefined, intentDeadline: deadlineAt(5000) }
  ])(
    'rejects a rehashed durable intent deadline mismatch: %j',
    async ({ commandDeadline, intentDeadline }) => {
      const h = await localDeadlineBindingFixture()
      const issuer = h.create()
      const input = LocalTaskBindingInputSchema.parse({
        ...h.input,
        executionMode: 'enforced_autonomous',
        ...(commandDeadline === undefined ? {} : { executionDeadlineAt: commandDeadline })
      })
      const binding = await issuer.issue(input)
      const grant = issuer.resolveGrant(binding.command.authorizationRef)
      if (!grant) {
        throw new Error('Missing original deadline fixture grant.')
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
      const bindingPath = join(h.options.directory, 'bindings', `${key}.json`)
      const intentPath = join(h.options.directory, 'bindings', `${key}.intent.json`)
      const { executionDeadlineAt: originalDeadline, ...intentInput } = input
      expect(originalDeadline).toBe(commandDeadline)
      const changedInput = {
        ...intentInput,
        ...(intentDeadline === undefined ? {} : { executionDeadlineAt: intentDeadline })
      }
      const fingerprint = digest(changedInput)
      await writeFile(intentPath, JSON.stringify({ fingerprint, input: changedInput }))
      const stored = JSON.parse(await readFile(bindingPath, 'utf8'))
      await writeFile(bindingPath, JSON.stringify({ ...stored, fingerprint }))
      await expect(
        readLocalTaskBinding({
          directory: h.options.directory,
          key,
          operationCallerKey: h.options.operationCallerKey,
          readExecution: h.options.readExecution
        })
      ).rejects.toThrow('OUTCOME_UNKNOWN')
      expect(await h.create().restoreBindings(h.records.tasks.listActive())).toEqual({
        restored: 0,
        unavailable: 1
      })
    }
  )
})
