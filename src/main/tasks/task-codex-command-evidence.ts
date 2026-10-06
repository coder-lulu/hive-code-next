import {
  agentJournalItemKey,
  parseAgentJournalItemKey
} from '../../shared/agent-session-journal-item-key'
import {
  TaskSessionSourceReferenceSchema,
  taskSessionSourceReference
} from '../../shared/task-execution/task-structured-binding'
import {
  WorkflowCommandEvidenceSchema,
  WorkflowCommandFactSchema,
  WORKFLOW_COMMAND_EVIDENCE_INLINE_BYTES,
  WORKFLOW_COMMAND_EVIDENCE_MAX_COMMANDS,
  type WorkflowCommandEvidence,
  type WorkflowCommandEvidenceUnavailableReason,
  type WorkflowCommandFact
} from '../../shared/task-workflow/workflow-command-evidence'
import { codexTurnLifecycleIdentity } from '../codex/codex-structured-journal-translation-turns'
import type { TaskExecutionRecord } from './task-execution-record'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'
import { readTaskCodexJournalEvidence } from './task-codex-journal-evidence'
import { TaskExecutionError } from './task-execution-error'
import { restoreTaskWorkflowCopyGuard } from './task-workflow-copy-guard'
import { assertTaskOutputWorkspace } from './task-output-workspace'
import { TASK_DOCKER_WORKSPACE } from './task-docker-codex-policy'

function unavailable(reason: WorkflowCommandEvidenceUnavailableReason): WorkflowCommandEvidence {
  return { kind: 'unavailable', reason }
}
function inputObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

/** Internal only: the original host store supplies the record; these facts grant no authority or approval. */
export async function collectTaskCodexCommandEvidence(
  record: TaskExecutionRecord
): Promise<WorkflowCommandEvidence> {
  let producer
  try {
    producer = taskCodeSnapshotProducer(record)
  } catch {
    return unavailable('record_not_stopped')
  }
  let journal
  try {
    const code = await restoreTaskWorkflowCopyGuard(record.workspace, record.command, () => {
      assertTaskOutputWorkspace(record.workspace)
    })
    code?.assertUnchanged()
    journal = await readTaskCodexJournalEvidence(record)
    code?.assertUnchanged()
  } catch (error) {
    return unavailable(
      error instanceof TaskExecutionError ? 'journal_binding_unavailable' : 'journal_unavailable'
    )
  }
  if (!journal) {
    return unavailable('journal_binding_unavailable')
  }
  const { session, sessionId, snapshot, submission, turnItem, turn } = journal
  const promptIdentity = submission.providerItemId
    ? parseAgentJournalItemKey(submission.providerItemId)
    : null
  const handle = session.providerHandleChain?.at(-1)?.handle
  const source = TaskSessionSourceReferenceSchema.safeParse(session.taskSource)
  if (
    session.sessionId !== sessionId ||
    snapshot.sessionId !== sessionId ||
    handle?.provider !== 'codex' ||
    promptIdentity?.provider !== 'codex' ||
    promptIdentity.threadId !== handle.threadId ||
    promptIdentity.turnId !== turn.turnId ||
    promptIdentity.ordinal !== 0 ||
    turnItem.itemId !== agentJournalItemKey(codexTurnLifecycleIdentity(sessionId, turn.turnId)) ||
    !source.success ||
    JSON.stringify(source.data) !== JSON.stringify(taskSessionSourceReference(record))
  ) {
    return unavailable('journal_binding_unavailable')
  }
  const commands: WorkflowCommandFact[] = []
  for (const entry of snapshot.items) {
    const body = entry.body
    if (
      entry.agentId ||
      entry.turnScope?.kind !== 'turn' ||
      entry.turnScope.turnItemId !== turnItem.itemId ||
      body.kind !== 'tool-call' ||
      body.mcpIdentity
    ) {
      continue
    }
    const input = body.input
    if (
      ['shell', 'read', 'search', 'list'].includes(body.name) &&
      (!inputObject(input) || !('command' in input) || input.truncated === true)
    ) {
      return unavailable('command_metadata_unavailable')
    }
    if (!inputObject(input) || !('command' in input)) {
      continue
    }
    let inputBytes
    try {
      inputBytes = Buffer.byteLength(JSON.stringify(input))
    } catch {
      return unavailable('command_metadata_unavailable')
    }
    if (
      input.truncated === true ||
      typeof input.command !== 'string' ||
      typeof input.cwd !== 'string' ||
      inputBytes > WORKFLOW_COMMAND_EVIDENCE_INLINE_BYTES ||
      input.cwd !== TASK_DOCKER_WORKSPACE ||
      !body.callId ||
      entry.itemId !==
        agentJournalItemKey({
          provider: 'orca',
          clientMessageId: `codex-item:${handle.threadId}:${body.callId}`
        }) ||
      (body.state !== 'completed' && body.state !== 'failed') ||
      !Number.isSafeInteger(body.exitCode)
    ) {
      return unavailable('command_metadata_unavailable')
    }
    const fact = WorkflowCommandFactSchema.safeParse({
      itemId: entry.itemId,
      revision: entry.revision,
      callId: body.callId,
      sequence: entry.sequence,
      command: input.command,
      cwd: input.cwd,
      state: body.state,
      exitCode: body.exitCode,
      ...(body.durationMs === undefined ? {} : { durationMs: body.durationMs }),
      ...(body.output === undefined ? {} : { output: body.output })
    })
    if (!fact.success) {
      return unavailable('command_metadata_unavailable')
    }
    commands.push(fact.data)
    if (commands.length > WORKFLOW_COMMAND_EVIDENCE_MAX_COMMANDS) {
      return unavailable('command_limit_exceeded')
    }
  }
  const facts = WorkflowCommandEvidenceSchema.safeParse({
    kind: 'available',
    producer,
    sessionId,
    journalCursor: snapshot.cursor,
    turnItemId: turnItem.itemId,
    turnRevision: turnItem.revision,
    turnSequence: turnItem.sequence,
    providerTurnId: turn.turnId,
    turnOutcome: turn.outcome,
    commands
  })
  return facts.success ? facts.data : unavailable('command_metadata_unavailable')
}
