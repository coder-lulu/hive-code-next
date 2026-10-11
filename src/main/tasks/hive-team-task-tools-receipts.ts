import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { HiveWorkflowCaseCreateSchema } from '../../shared/hive-workflow-cases'
import { HiveWorkflowCaseStartSchema } from '../../shared/hive-workflow-case-runs'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import { readTaskArtifactFile } from './task-artifact-index'
import { taskLaunchPathKey } from './task-launch-workspace'
import { TeamToolScopeSchema, teamToolHash } from './hive-team-task-tools-scope'
import { refuseTaskExecution } from './task-execution-error'

const Identifier = z.string().min(1).max(512)
const Digest = z.string().regex(/^[a-f0-9]{64}$/)
const Operation = z
  .strictObject({
    turnId: Identifier,
    callIds: z.array(Identifier).min(1).max(32),
    payloadDigest: Digest,
    scope: TeamToolScopeSchema,
    createInput: HiveWorkflowCaseCreateSchema,
    caseRef: z.string().uuid().nullable(),
    startInput: HiveWorkflowCaseStartSchema.nullable(),
    startAttempted: z.boolean()
  })
  .superRefine((op, context) => {
    const create = op.createInput
    if (
      op.payloadDigest !== digest({ title: create.title, requirement: create.requirement }) ||
      create.requirement.length > 8192 ||
      create.projectId !== op.scope.projectId ||
      create.workflowId !== op.scope.workflowId ||
      create.workflowRevision !== op.scope.workflowRevision ||
      create.definitionDigest !== op.scope.definitionDigest ||
      create.expectedProjectRevision !== op.scope.projectRevision ||
      (op.startInput !== null &&
        (op.startInput.caseId !== op.caseRef || op.startInput.projectId !== op.scope.projectId)) ||
      (op.startAttempted && op.startInput === null) ||
      new Set(op.callIds).size !== op.callIds.length
    ) {
      context.addIssue({ code: 'custom', message: 'team_tool_receipt_mismatch' })
    }
  })
const Receipt = z
  .strictObject({
    sessionHash: Digest,
    catalog: z.strictObject({ providerThreadId: Identifier, catalogDigest: Digest }).nullable(),
    operations: z.array(Operation).max(32)
  })
  .superRefine((receipt, context) => {
    if (
      new Set(receipt.operations.map((op) => op.turnId)).size !== receipt.operations.length ||
      new Set(receipt.operations.flatMap((op) => op.callIds)).size !==
        receipt.operations.reduce((sum, op) => sum + op.callIds.length, 0)
    ) {
      context.addIssue({ code: 'custom', message: 'team_tool_receipt_conflict' })
    }
  })
const Envelope = z.strictObject({ receipt: Receipt, digest: Digest })
export type TeamToolReceipt = z.infer<typeof Receipt>
export type TeamToolOperation = z.infer<typeof Operation>
const MAXIMUM_BYTES = 2 * 1024 * 1024
const pending = new Map<string, Promise<unknown>>()

export function teamToolReceiptStore(directory: string, sessionId: string) {
  const root = resolve(directory, 'conversation-tools')
  const sessionHash = teamToolHash(sessionId)
  const name = `${sessionHash}.json`
  const path = join(root, name)
  const checkDirectory = async () => {
    for (const candidate of [resolve(directory), root]) {
      await mkdir(candidate, { recursive: true, mode: 0o700 })
      const stat = await lstat(candidate)
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        taskLaunchPathKey(await realpath(candidate)) !== taskLaunchPathKey(candidate)
      ) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
  }
  return {
    async exclusive<T>(operation: () => Promise<T>): Promise<T> {
      const before = pending.get(path) ?? Promise.resolve()
      const next = before.catch(() => {}).then(operation)
      pending.set(path, next)
      try {
        return await next
      } finally {
        if (pending.get(path) === next) {
          pending.delete(path)
        }
      }
    },
    async read(): Promise<TeamToolReceipt> {
      await checkDirectory()
      try {
        const contents = await readTaskArtifactFile(root, name, MAXIMUM_BYTES)
        const envelope = Envelope.parse(JSON.parse(contents.toString('utf8')))
        if (
          envelope.receipt.sessionHash !== sessionHash ||
          digest(envelope.receipt) !== envelope.digest
        ) {
          return refuseTaskExecution('REVISION_CONFLICT')
        }
        return envelope.receipt
      } catch (error) {
        if (
          error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return { sessionHash, catalog: null, operations: [] }
        }
        throw error
      }
    },
    async write(receipt: TeamToolReceipt, assertCurrent: () => void) {
      await checkDirectory()
      const parsed = Receipt.parse(receipt)
      if (parsed.sessionHash !== sessionHash) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      try {
        await readTaskArtifactFile(root, name, MAXIMUM_BYTES)
      } catch (error) {
        if (
          error === null ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        ) {
          throw error
        }
      }
      const contents = JSON.stringify({ receipt: parsed, digest: digest(parsed) })
      if (Buffer.byteLength(contents) > MAXIMUM_BYTES) {
        return refuseTaskExecution('CAPACITY_EXCEEDED')
      }
      assertCurrent()
      writeFileAtomically(path, contents, { mode: 0o600 })
      const file = await open(path, 'r+')
      try {
        await file.sync()
      } finally {
        await file.close()
      }
      assertCurrent()
    }
  }
}
