import { z } from 'zod'
import type { NativeTeamTaskToolFactory } from '../../shared/hive-team-task-tools'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import type { HiveTeamTaskToolOptions } from './hive-team-task-tool-ports'
import { teamToolReceiptStore } from './hive-team-task-tools-receipts'
import { resolveTeamToolScope, teamToolOwner } from './hive-team-task-tools-scope'
import { readTeamToolStatus, startTeamToolCase } from './hive-team-task-tools-operations'
import { refuseTaskExecution, TASK_EXECUTION_ERROR_CODES } from './task-execution-error'

const Identifier = z.string().min(1).max(512)
const Session = z.strictObject({ sessionId: Identifier, workspaceSelector: Identifier })
const Call = z.strictObject({
  name: z.enum(['hive_team_task_start', 'hive_team_task_status']),
  arguments: z.unknown(),
  callId: Identifier,
  turnId: Identifier
})
const Start = z.strictObject({
  title: z.string().trim().min(1).max(240),
  requirement: z.string().trim().min(1).max(8192)
})
const Status = z.strictObject({ caseRef: z.string().uuid().optional() })
const definitions = [
  {
    name: 'hive_team_task_start',
    description:
      'Create and start a team workflow Case for the current workspace. Use only when the user requests team execution. A retry in the same turn reuses the same Case. This does not adopt or start a business plan graph.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'requirement'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 240 },
        requirement: { type: 'string', minLength: 1, maxLength: 8192 }
      }
    }
  },
  {
    name: 'hive_team_task_status',
    description:
      'Read a team Case created by this conversation. Omit caseRef to inspect the last start operation, including an uncertain response. Status never retries execution.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { caseRef: { type: 'string', format: 'uuid' } }
    }
  }
] as const

export function createHiveTeamTaskToolFactory(
  options: HiveTeamTaskToolOptions
): NativeTeamTaskToolFactory {
  return (input) => {
    const session = Session.parse({
      sessionId: input.sessionId,
      workspaceSelector: input.workspaceSelector
    })
    const store = teamToolReceiptStore(options.directory, session.sessionId)
    let ownerDigest: string | null = null
    let boundThread: string | null = null
    const catalogDigest = digest({ definitions })
    return {
      definitions,
      async bindThread(threadId, resumed, supersededThreadId) {
        Identifier.parse(threadId)
        if (supersededThreadId !== undefined) {
          Identifier.parse(supersededThreadId)
        }
        return store.exclusive(async () => {
          boundThread = null
          input.assertCurrent()
          const receipt = await store.read()
          input.assertCurrent()
          const catalog = { providerThreadId: threadId, catalogDigest }
          if (supersededThreadId !== undefined) {
            if (
              resumed ||
              supersededThreadId === threadId ||
              receipt.catalog?.providerThreadId !== supersededThreadId ||
              receipt.catalog.catalogDigest !== catalogDigest ||
              receipt.operations.length !== 0
            ) {
              return false
            }
            receipt.catalog = catalog
            await store.write(receipt, input.assertCurrent)
          }
          if (receipt.catalog && digest(receipt.catalog) !== digest(catalog)) {
            return false
          }
          if (resumed && !receipt.catalog) {
            return false
          }
          if (!receipt.catalog) {
            receipt.catalog = catalog
            await store.write(receipt, input.assertCurrent)
          }
          boundThread = threadId
          return true
        })
      },
      async call(raw, callGuard) {
        return store.exclusive(async () => {
          try {
            const call = Call.parse(raw)
            const argumentsValue =
              call.name === 'hive_team_task_start'
                ? Start.parse(call.arguments)
                : Status.parse(call.arguments)
            const workspaceGuards: (() => void)[] = []
            const check = () => {
              input.assertCurrent()
              callGuard()
              workspaceGuards.forEach((guard) => guard())
              const owner = teamToolOwner(options)
              ownerDigest ??= owner.ownerDigest
              if (owner.ownerDigest !== ownerDigest || !boundThread) {
                return refuseTaskExecution('FORBIDDEN')
              }
            }
            check()
            const scopedOptions = {
              ...options,
              resolveWorkspaceSource: async (selector: string) => {
                const source = await options.resolveWorkspaceSource(selector)
                workspaceGuards.push(() => source.assertCurrent())
                check()
                return source
              }
            }
            const receipt = await store.read()
            check()
            if (
              receipt.catalog?.providerThreadId !== boundThread ||
              receipt.catalog?.catalogDigest !== catalogDigest
            ) {
              return refuseTaskExecution('FORBIDDEN')
            }
            const scope = await resolveTeamToolScope(
              scopedOptions,
              session.workspaceSelector,
              check
            )
            if (receipt.operations.some((operation) => digest(operation.scope) !== digest(scope))) {
              return refuseTaskExecution('REVISION_CONFLICT')
            }
            const context = {
              options,
              receipt,
              scope,
              assertCurrent: check,
              save: () => store.write(receipt, check),
              validateScope: async () => {
                const current = await resolveTeamToolScope(
                  scopedOptions,
                  session.workspaceSelector,
                  check
                )
                if (digest(current) !== digest(scope)) {
                  return refuseTaskExecution('REVISION_CONFLICT')
                }
                check()
              }
            }
            let value: Record<string, unknown>
            if (call.name === 'hive_team_task_start') {
              value = await startTeamToolCase(
                context,
                Start.parse(argumentsValue),
                call.turnId,
                call.callId
              )
            } else {
              const { caseRef } = Status.parse(argumentsValue)
              const operation = caseRef
                ? receipt.operations.find((op) => op.caseRef === caseRef)
                : receipt.operations.at(-1)
              if (caseRef && !operation) {
                return refuseTaskExecution('FORBIDDEN')
              }
              if (operation && digest(operation.scope) !== digest(scope)) {
                return refuseTaskExecution('REVISION_CONFLICT')
              }
              value = operation
                ? await readTeamToolStatus(context, operation)
                : { state: 'no_record' }
            }
            check()
            return { success: true, value }
          } catch (error) {
            const candidate =
              error !== null && typeof error === 'object' && 'code' in error
                ? error.code
                : undefined
            const code =
              TASK_EXECUTION_ERROR_CODES.find((known) => known === candidate) ??
              (error instanceof z.ZodError ? 'INVALID_REQUEST' : 'SERVICE_UNAVAILABLE')
            return {
              success: false,
              value: {
                code,
                state: 'unconfirmed',
                guidance:
                  'Use hive_team_task_status to inspect the last operation; do not create a replacement Case for an uncertain response.'
              }
            }
          }
        })
      }
    }
  }
}
