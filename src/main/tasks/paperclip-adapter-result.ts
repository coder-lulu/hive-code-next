import type { TaskExecutionObservation } from '../../shared/task-execution/task-execution-observation'
import type { HiveRuntimeBinding, PaperclipTaskExecutionResult } from './paperclip-adapter-contract'

const unknownBilling = { costUsd: null, usageBasis: null, billingType: 'unknown' as const }

export function paperclipExecutionReferences(
  binding: HiveRuntimeBinding,
  sessionRef: string | null
) {
  return {
    bindingRef: binding.bindingRef,
    runtimeRecordId: binding.command.runtimeRecordId,
    ownershipEpoch: binding.command.ownershipEpoch,
    executionId: binding.command.executionId,
    executionEpoch: binding.command.executionEpoch,
    commandFingerprint: binding.commandFingerprint,
    sessionRef
  }
}

export function paperclipTaskTerminalResult(
  binding: HiveRuntimeBinding,
  observation: TaskExecutionObservation
): PaperclipTaskExecutionResult {
  const result = observation.result!
  return {
    ...unknownBilling,
    exitCode: result.status === 'succeeded' ? 0 : result.status === 'cancelled' ? null : 1,
    signal: result.status === 'cancelled' ? 'SIGTERM' : null,
    timedOut: false,
    sessionParams: paperclipExecutionReferences(binding, observation.sessionRef),
    sessionDisplayId: observation.sessionRef,
    resultJson: {
      ...paperclipExecutionReferences(binding, observation.sessionRef),
      status: result.status,
      resultRef: result.receiptId,
      outcomeRef: result.outcomeRef,
      artifactRefs: result.artifactRefs,
      stopProofRef: result.stopProof.proofRef,
      usageFactRefs: result.usageFactRefs
    }
  }
}

export function paperclipTaskErrorResult(
  code: string,
  binding: HiveRuntimeBinding | null,
  dispatched: boolean,
  timedOut = false
): PaperclipTaskExecutionResult {
  return {
    ...unknownBilling,
    exitCode: dispatched ? null : 1,
    signal: null,
    timedOut,
    errorCode: dispatched ? 'OUTCOME_UNKNOWN' : code,
    errorMessage: dispatched
      ? 'Hive execution requires reconciliation.'
      : 'Hive execution is unavailable.',
    ...(binding
      ? {
          sessionParams: paperclipExecutionReferences(binding, null),
          resultJson: {
            ...paperclipExecutionReferences(binding, null),
            status: dispatched ? 'outcome_unknown' : 'unavailable'
          }
        }
      : {})
  }
}
