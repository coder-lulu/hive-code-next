import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { vi } from 'vitest'
import { createTaskDispatch } from '../../../integration/paperclip/service/task-dispatch.mjs'
import { hiveWorkflowStagePrompt } from '../../shared/hive-workflow-stage-prompt'
import { createHiveWorkflowCaseRunFacade } from './hive-workflow-case-run-facade'
import { createHiveTaskServiceContext } from './hive-task-service-context'
import { workflowPrepareFixture } from './local-task-workflow-prepare.test-fixture'

export function workflowRaceBarrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Real dispatcher/Main HTTP/issuer/files; service rows, authority and delivery are synthetic. */
export async function workflowStartRaceFixture() {
  const f = await workflowPrepareFixture(
    resolve('logs/paperclip-development/p3/task-native-acceptance-contract/start-race-writer/f')
  )
  const frontView = structuredClone(f.view)
  frontView.stageTasks[0].status = 'backlog'
  frontView.stageTasks[0].taskRevision = 0
  f.admission.replayed = false
  f.admission.input = hiveWorkflowStagePrompt(frontView, f.admission.run.stageRef)
  f.admission.inputDigest = createHash('sha256')
    .update(JSON.stringify(f.admission.input))
    .digest('hex')
  const delivered = workflowRaceBarrier()
  const joined = workflowRaceBarrier()
  const releaseDelivery = workflowRaceBarrier()
  const repository = {
    read: vi.fn(async () => structuredClone(f.task)),
    listRecoverableRuns: vi.fn(async () => ({
      items: [{ ...structuredClone(f.task), prepareRefs: f.refs }],
      nextCursor: null
    })),
    getCurrentDelivery: vi.fn(async () => null),
    claimDelivery: vi.fn(
      async (
        accountId: string,
        taskId: string,
        runId: string,
        token: { ownerId: string; leaseRef: string }
      ) => ({
        protocolVersion: 1,
        runtimeRecordId: f.task.binding!.command.runtimeRecordId,
        ownershipEpoch: f.task.binding!.command.ownershipEpoch,
        executionId: f.task.binding!.command.executionId,
        executionEpoch: f.task.binding!.command.executionEpoch,
        operationId: f.task.binding!.command.operationId,
        workspaceExecutionClaimRef: f.task.binding!.command.workspaceExecutionClaimRef,
        writeFence: f.task.binding!.command.writeFence,
        ownerId: token.ownerId,
        leaseRef: token.leaseRef,
        generation: 1,
        accountId,
        companyId: f.task.company_id,
        taskId,
        runId,
        commandFingerprint: f.task.binding!.commandFingerprint,
        cursor: 0,
        serverNow: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30_000).toISOString()
      })
    ),
    claimDispatch: vi.fn(async () => {
      f.task.run_status = 'running'
    }),
    drain: vi.fn(async () => f.task),
    unknown: vi.fn(async () => f.task),
    releaseDelivery: vi.fn(async () => undefined)
  }
  const execute = vi.fn(async () => {
    delivered.resolve()
    await releaseDelivery.promise
    return { exitCode: null }
  })
  const bridge = vi.fn(async () => f.client)
  const dispatch = createTaskDispatch(repository, {
    createClient: bridge,
    createAdapter: () => ({ execute })
  })
  const originalContext = createHiveTaskServiceContext({
    descriptorPath: join(f.directory, 'paperclip.json'),
    currentAccount: f.issuerOptions.currentAccount,
    assertCurrent: f.issuerOptions.assertCurrent
  })
  const facade = createHiveWorkflowCaseRunFacade({
    context: async () => {
      const caller = await originalContext()
      return {
        ...caller,
        request: async (path: string, body?: unknown) => {
          if (path.endsWith('/cases/start')) {
            return structuredClone(f.admission)
          }
          if (path.endsWith('/dispatch')) {
            joined.resolve()
            return dispatch.start(f.owner.accountId, f.task.id, f.task.run_id)
          }
          return caller.request(path, body)
        }
      }
    },
    getWorkflowCase: async () => structuredClone(frontView),
    workspaceSelector: async () => f.admission.workspaceSelector,
    validateWorkspace: async () => ({
      workspaceRef: f.view.team.project.hiveWorkspaceRef,
      assertCurrent: f.issuerOptions.assertCurrent
    }),
    issuer: f.issuer,
    enforcement: async () => ({ assertCurrent: f.issuerOptions.assertCurrent })
  }).facade
  const holds: (() => void)[] = []
  const holdIssue = () => {
    const issued = workflowRaceBarrier()
    const release = workflowRaceBarrier()
    holds.push(release.resolve)
    const original = Object.getPrototypeOf(f.issuer).issue.bind(f.issuer)
    f.issue.mockImplementationOnce(async (input) => {
      const binding = await original(input)
      issued.resolve()
      await release.promise
      return binding
    })
    return { issued, release }
  }
  return {
    ...f,
    repository,
    dispatch,
    facade,
    execute,
    delivered,
    joined,
    holdIssue,
    holdPreparationEntry() {
      const entered = workflowRaceBarrier(),
        release = workflowRaceBarrier()
      holds.push(release.resolve)
      bridge.mockResolvedValueOnce(f.client).mockImplementationOnce(async () => {
        entered.resolve()
        await release.promise
        return f.client
      })
      return { entered, release }
    },
    async close() {
      holds.forEach((release) => release())
      releaseDelivery.resolve()
      await dispatch.close().catch(() => {})
      await f.close()
    }
  }
}
