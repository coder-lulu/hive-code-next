import { observeStructuredWorker } from '../runtime/structured-worker-authority'
import { closeStructuredAgentSessionChild } from '../runtime/structured-agent-session-close'
import type { TaskExecutionRecord } from './task-execution-record'
import type { TaskExecutionStopEvidence } from './task-execution-ports'
import { TaskArtifactIndex, taskResultManifestName } from './task-artifact-index'
import { restoreTaskWorkflowCopyGuard } from './task-workflow-copy-guard'
import { assertTaskOutputWorkspace } from './task-output-workspace'
import { taskCodexSessionFor, readTaskCodexJournalEvidence } from './task-codex-journal-evidence'
import { collectTaskCodexCommandEvidence } from './task-codex-command-evidence'

export function taskCodexResultInstructions(
  record: Pick<TaskExecutionRecord, 'command' | 'commandFingerprint'>
) {
  const tester = record.command.workflowContext?.role === 'tester'
  const filename = taskResultManifestName(record.commandFingerprint)
  return (
    `\n\nTask completion contract: write a result manifest only after your artifact files are complete.\n` +
    `Manifest filename: ${tester ? `/outputs/${filename}` : filename}\n${
      tester
        ? 'The fixed code at /workspace is read-only. Write report files and build outputs under /outputs; artifact paths are relative to /outputs. Use /tmp for disposable test data.\n'
        : ''
    }Manifest JSON: ${JSON.stringify({
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

/** Provider verdict and real child-close evidence are separate from a result candidate. */
export function createTaskCodexEvidence(directory: string) {
  const artifacts = new TaskArtifactIndex(directory)
  return {
    collectCommands: collectTaskCodexCommandEvidence,
    async collect(record: TaskExecutionRecord) {
      const journal = await readTaskCodexJournalEvidence(record)
      if (!journal) {
        return null
      }
      const code = await restoreTaskWorkflowCopyGuard(record.workspace, record.command, () => {
        assertTaskOutputWorkspace(record.workspace)
      })
      code?.assertUnchanged()
      const candidate = await artifacts.collect(record, journal.turnOutcome)
      code?.assertUnchanged()
      return candidate
    },
    async stop(record: TaskExecutionRecord): Promise<TaskExecutionStopEvidence | null> {
      if (record.dispatch === 'dispatching') {
        return null
      }
      const binding = taskCodexSessionFor(record)
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
