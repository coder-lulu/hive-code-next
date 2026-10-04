import { TaskExecutionObservationSchema } from '../../shared/task-execution/task-execution-observation'
import { taskExecutionIdentity, type TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

export function taskRecordObservation(record: TaskExecutionRecord, after: number, limit: number) {
  if (after > record.events.length) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  // Persisted event sequences are contiguous and start at one.
  const events = record.events.slice(after, after + limit)
  return TaskExecutionObservationSchema.parse({
    ...taskExecutionIdentity(record.command),
    kind: 'execution.observation',
    commandFingerprint: record.commandFingerprint,
    status: record.status,
    accepted: record.accepted,
    events,
    cursor: events.at(-1)?.sequence ?? after,
    lastSequence: record.events.length,
    result: record.result,
    sessionRef:
      record.launch?.outcome.kind === 'structured'
        ? record.launch.outcome.sessionId
        : (record.launch?.outcome.handle ?? null)
  })
}
