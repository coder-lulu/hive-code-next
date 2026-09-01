import type { OrchestrationWorkerLaunchReceipt } from './orchestration-worker-launch-preferences'
import { PRIMARY_CLI_COMMAND } from '../../../../shared/brand'

export function federatedUnknownReceipt(
  worker: { dispatch_id: string; state: string; stage: string; last_error: string | null },
  taskId: string,
  serverName: string,
  launch: OrchestrationWorkerLaunchReceipt
): unknown {
  return {
    taskId,
    dispatchId: worker.dispatch_id,
    state: 'outcome_unknown',
    stage: worker.stage,
    server: { name: serverName },
    launch,
    failedStage: worker.stage,
    lastError: worker.last_error,
    effects: [],
    residualResources: [],
    nextCommands: [
      `${PRIMARY_CLI_COMMAND} orchestration worker-show --dispatch ${worker.dispatch_id} --json`,
      `${PRIMARY_CLI_COMMAND} orchestration worker-abandon --dispatch ${worker.dispatch_id} --json`
    ]
  }
}
