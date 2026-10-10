import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { planPrepareFixture } from './local-task-plan-prepare.test-fixture'
import { HiveRuntimeAdapterBinding } from './paperclip-adapter-contract'
import { TaskExecutionHost } from './task-execution-host'
import { taskExecutionIdentity } from './task-execution-record'
import { createLocalTaskAuthorizer } from './local-task-authority'
import { taskCapabilities, taskStopEvidence } from './task-execution.test-fixture'
import { assertTaskDockerEnforcementCommand } from './task-docker-enforcement'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'

const fixtures: Awaited<ReturnType<typeof planPrepareFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
})

describe('expired original plan cancellation through private Main preparation', () => {
  it.each(['running', 'paused', 'cancel_requested'] as const)(
    'binds queued cancellation on %s graph and obtains native not-started proof without launching',
    async (status) => {
      const f = await planPrepareFixture()
      fixtures.push(f)
      const deadline = new Date(Date.now() - 1000).toISOString()
      f.graph.graph!.deadlineAt = deadline
      f.graph.graph!.startedAt = new Date(
        Date.parse(deadline) - f.graph.graph!.maxDurationMs
      ).toISOString()
      f.graph.graph!.status = status
      f.admission.executionDeadlineAt = deadline
      f.admission.run.status = 'cancelRequested'
      f.graph.runs[0].status = 'cancelRequested'
      f.task.cancel_requested = true
      await expect(f.client.preparePlanRun(f.refs)).resolves.toEqual(f.refs)
      const binding = HiveRuntimeAdapterBinding.parse(
        await f.client.binding(f.task.company_id, f.refs.runId, 'recover')
      )
      expect(binding.command.executionDeadlineAt).toBe(deadline)
      const grant = f.issuer.resolveGrant(binding.command.authorizationRef)!
      expect(grant.actions).toEqual(['observe', 'reconcile', 'cancel'])
      await expect(f.client.binding(f.task.company_id, f.refs.runId, 'execute')).rejects.toThrow(
        'FORBIDDEN'
      )
      const directory = join(f.root, 'journal')
      const store = await openTestAgentSessionRecordStore(directory)
      const launch = vi.fn(async () => {
        throw new Error('Must never launch cancellation')
      })
      const host = new TaskExecutionHost({
        store: store.tasks,
        authorizeEnforcement: async (command, action) => {
          if (action === 'start') {
            assertTaskDockerEnforcementCommand(command, await f.issuerOptions.resolveEnforcement())
          }
        },
        authorize: createLocalTaskAuthorizer({
          ...f.issuerOptions,
          resolveGrant: f.issuer.resolveGrant
        }),
        capabilities: () => taskCapabilities(binding.command),
        resolveStart: () => binding.command,
        launch,
        collect: async () => null,
        stop: async (record) => taskStopEvidence(record)
      })
      try {
        const result = await host.cancel(
          {
            ...taskExecutionIdentity(binding.command),
            kind: 'execution.cancel',
            task: binding.command.task,
            idempotencyKey: 'cancel:expired-plan',
            commandFingerprint: binding.commandFingerprint,
            authorizationRef: binding.command.authorizationRef,
            authorizationRevision: binding.command.authorizationRevision,
            expiresAt: binding.command.expiresAt,
            reason: 'user_requested'
          },
          f.caller
        )
        expect(result.result?.status).toBe('cancelled')
        expect(result.result?.stopProof.evidenceKind).toBe('not_started')
        expect(launch).not.toHaveBeenCalled()
        expect(f.unavailable).not.toHaveBeenCalled()
        expect(f.requests.some(({ path }) => path.endsWith('/dispatch'))).toBe(false)
      } finally {
        await host.drain()
        closeTestJournalHostDatabase(directory)
      }
    }
  )
})
