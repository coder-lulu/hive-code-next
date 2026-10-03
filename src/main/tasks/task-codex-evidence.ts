import { readAgentJournalTurn } from '../../shared/agent-session-turn-record'
import { agentJournalSubmissionKey } from '../../shared/agent-session-journal-item-key'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { observeStructuredWorker } from '../runtime/structured-worker-authority'
import { closeStructuredAgentSessionChild } from '../runtime/structured-agent-session-close'
import type { TaskExecutionRecord } from './task-execution-record'
import type { TaskExecutionStopEvidence } from './task-execution-ports'
import { TaskArtifactIndex, taskResultManifestName } from './task-artifact-index'
import { refuseTaskExecution } from './task-execution-error'

export function taskCodexResultInstructions(
  record: Pick<TaskExecutionRecord, 'command' | 'commandFingerprint'>
) {
  return (
    `\n\nTask completion contract: write a result manifest only after your artifact files are complete.\n` +
    `Manifest filename: ${taskResultManifestName(record.commandFingerprint)}\n` +
    `Manifest JSON: ${JSON.stringify({
      schemaVersion: 1,
      executionId: record.command.executionId,
      commandFingerprint: record.commandFingerprint,
      status: 'succeeded',
      artifacts: ['report.md']
    })}\n` +
    `Replace artifacts with the relative paths you produced; use status failed if the task failed. ` +
    `Stay inside this isolated workspace. Do not start detached processes. The host verifies your result and stops the execution before settlement.`
  )
}

function sessionFor(record: TaskExecutionRecord) {
  if (record.launch?.outcome.kind !== 'structured') {
    return null
  }
  const host = getStructuredAgentSessionHost()
  const sessionId = record.launch.outcome.sessionId
  const session = host?.deps.store.getRecord(sessionId)
  if (
    !host ||
    !session ||
    session.provider !== 'codex' ||
    session.location.executionHostId !== 'local' ||
    session.location.wslDistro ||
    session.location.workspaceId !== record.workspace.workspaceId
  ) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  return { host, session, sessionId }
}

/** Provider verdict and real child-close evidence are separate from a result candidate. */
export function createTaskCodexEvidence(directory: string) {
  const artifacts = new TaskArtifactIndex(directory)
  return {
    async collect(record: TaskExecutionRecord) {
      const binding = sessionFor(record)
      const prompt = record.launch?.prompt
      if (!binding || prompt?.outcome !== 'journaled') {
        return null
      }
      await binding.host.flushStreamedEvents(binding.sessionId)
      const snapshot = await binding.host.journalSnapshot(binding.sessionId)
      const submission = snapshot.submissions.find(
        (entry) => entry.clientMessageId === prompt.messageId
      )
      if (!submission || submission.dispatchState !== 'accepted' || !submission.providerItemId) {
        return null
      }
      const turns = snapshot.items
        .filter((entry) => !entry.agentId)
        .map((entry) => readAgentJournalTurn(entry.body))
      const turn = turns.find(
        (entry) => entry?.userItemId === agentJournalSubmissionKey(prompt.messageId)
      )
      if (
        !turn ||
        turn.state !== 'completed' ||
        (turn.outcome !== 'success' && turn.outcome !== 'failure')
      ) {
        return null
      }
      if (
        snapshot.items.some(
          (entry) =>
            (entry.body.kind === 'tool-call' && entry.body.state === 'running') ||
            readAgentJournalTurn(entry.body)?.state === 'running'
        )
      ) {
        return null
      }
      return artifacts.collect(record, turn.outcome)
    },
    async stop(record: TaskExecutionRecord): Promise<TaskExecutionStopEvidence | null> {
      if (record.dispatch === 'dispatching') {
        return null
      }
      const binding = sessionFor(record)
      if (record.dispatch !== 'not_dispatched' && !binding) {
        return null
      }
      if (binding) {
        const stopped = await closeStructuredAgentSessionChild(binding.sessionId)
        // UI cleanup accepts released leases without death evidence; tasks require observed death.
        if (
          !stopped.stopped ||
          observeStructuredWorker({ sessionId: binding.sessionId }).status !== 'exited'
        ) {
          return null
        }
      }
      return {
        runtimeRecordId: record.command.runtimeRecordId,
        ownershipEpoch: record.command.ownershipEpoch,
        executionId: record.command.executionId,
        executionEpoch: record.command.executionEpoch,
        commandFingerprint: record.commandFingerprint,
        operationId: record.command.operationId,
        operationCallerKey: record.operationCallerKey,
        workspaceExecutionClaimRef: record.command.workspaceExecutionClaimRef,
        writeFence: record.command.writeFence,
        evidenceKind: binding ? 'stopped' : 'not_started',
        managedToolsSettled: true,
        writersFenced: true
      }
    }
  }
}
