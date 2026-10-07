import { canonicalAgentSessionDigest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { TaskExecutionObservationSchema } from '../../../src/shared/task-execution/task-execution-observation.ts'
import { TaskExecutionResultSchema } from '../../../src/shared/task-execution/task-execution-receipts.ts'
import { WorkflowNativeDeliverySchema } from '../../../src/shared/task-workflow/workflow-native-delivery.ts'
import {
  TaskDeliveryToken,
  assertTaskReceiptIdentity,
  requireCurrentTaskDelivery,
  requireTaskRepositoryScope,
  refuseTaskRepository
} from './task-delivery-repository.mjs'

const digest = canonicalAgentSessionDigest

async function recordInboxEvent(db, accountId, task, event, cursor) {
  const hash = digest(event)
  const inserted = await db`INSERT INTO hive_task_event_inbox(
      task_id,account_id,run_id,runtime_record_id,ownership_epoch,execution_id,execution_epoch,
      command_fingerprint,sequence,payload_hash,payload)
    VALUES(${task.id},${accountId},${task.run_id},${event.runtimeRecordId},${event.ownershipEpoch},
      ${event.executionId},${event.executionEpoch},${event.commandFingerprint},${event.sequence},${hash},${db.json(event)})
    ON CONFLICT (runtime_record_id,ownership_epoch,execution_id,execution_epoch,command_fingerprint,sequence)
      DO NOTHING RETURNING payload_hash`
  if (inserted.length) {
    if (event.sequence <= cursor) {
      refuseTaskRepository('OUTCOME_UNKNOWN')
    }
    return
  }
  const [previous] = await db`SELECT payload_hash,payload FROM hive_task_event_inbox
    WHERE account_id=${accountId} AND task_id=${task.id} AND run_id=${task.run_id}
      AND runtime_record_id=${event.runtimeRecordId} AND ownership_epoch=${event.ownershipEpoch}
      AND execution_id=${event.executionId} AND execution_epoch=${event.executionEpoch}
      AND command_fingerprint=${event.commandFingerprint} AND sequence=${event.sequence}`
  if (!previous || previous.payload_hash !== hash || digest(previous.payload) !== hash) {
    refuseTaskRepository('IDEMPOTENCY_CONFLICT')
  }
}

/** Inbox, continuous cursor and business settlement commit together; this method never starts execution. */
export function createTaskInboxRepository(sql, { read, settle }) {
  return {
    async consumeObservation(
      accountId,
      taskId,
      runId,
      rawToken,
      rawObservation,
      rawNativeDelivery
    ) {
      requireTaskRepositoryScope(accountId, taskId, runId)
      const token = TaskDeliveryToken.parse(rawToken)
      const observation = TaskExecutionObservationSchema.parse(rawObservation)
      const nativeDelivery =
        rawNativeDelivery === undefined
          ? undefined
          : WorkflowNativeDeliverySchema.parse(rawNativeDelivery)
      return sql.begin(async (db) => {
        let task = await read(db, accountId, taskId, runId, true)
        const binding = assertTaskReceiptIdentity(task, observation)
        if (
          observation.accepted.operationId !== binding.command.operationId ||
          observation.accepted.workspaceExecutionClaimRef !==
            binding.command.workspaceExecutionClaimRef ||
          observation.accepted.writeFence !== binding.command.writeFence
        ) {
          refuseTaskRepository('IDEMPOTENCY_CONFLICT')
        }
        const delivery = await requireCurrentTaskDelivery(db, accountId, task, token)
        const cursor = Number(delivery.event_cursor)
        const acceptedHash = digest(observation.accepted)
        if (delivery.accepted_hash && delivery.accepted_hash !== acceptedHash) {
          refuseTaskRepository('IDEMPOTENCY_CONFLICT')
        }
        const first = observation.events[0]
        if ((first && first.sequence > cursor + 1) || (!first && observation.cursor > cursor)) {
          refuseTaskRepository('SEQUENCE_GAP')
        }
        let terminalSequence =
          delivery.terminal_sequence == null ? null : Number(delivery.terminal_sequence)
        let terminalReceipt =
          delivery.terminal_receipt == null
            ? null
            : TaskExecutionResultSchema.parse(delivery.terminal_receipt)
        let terminalHash = delivery.terminal_hash
        if (terminalReceipt && digest(terminalReceipt) !== terminalHash) {
          refuseTaskRepository('IDEMPOTENCY_CONFLICT')
        }
        if (
          terminalSequence !== null &&
          (observation.lastSequence > terminalSequence ||
            (!observation.result && observation.lastSequence === terminalSequence))
        ) {
          refuseTaskRepository('IDEMPOTENCY_CONFLICT')
        }
        if (observation.result) {
          const hash = digest(observation.result)
          if (
            terminalSequence !== null &&
            (terminalSequence !== observation.lastSequence || terminalHash !== hash)
          ) {
            refuseTaskRepository('IDEMPOTENCY_CONFLICT')
          }
          terminalSequence = observation.lastSequence
          terminalReceipt = observation.result
          terminalHash = hash
        }
        if (terminalSequence !== null && Number(delivery.last_sequence) > terminalSequence) {
          refuseTaskRepository('IDEMPOTENCY_CONFLICT')
        }
        for (const event of observation.events) {
          await recordInboxEvent(db, accountId, task, event, cursor)
        }
        const nextCursor = Math.max(cursor, observation.cursor)
        const lastSequence = Math.max(Number(delivery.last_sequence), observation.lastSequence)
        const updated = await db`UPDATE hive_task_deliveries
          SET event_cursor=${nextCursor},last_sequence=${lastSequence},accepted_receipt=${db.json(observation.accepted)},
            accepted_hash=${acceptedHash},terminal_sequence=${terminalSequence},
            terminal_receipt=${terminalReceipt === null ? null : db.json(terminalReceipt)},terminal_hash=${terminalHash}
          WHERE account_id=${accountId} AND task_id=${taskId} AND run_id=${task.run_id}
            AND owner_id=${token.ownerId} AND lease_ref=${token.leaseRef} AND generation=${token.generation}
            AND expires_at>clock_timestamp() RETURNING task_id`
        if (!updated.length) {
          refuseTaskRepository('OUTCOME_UNKNOWN')
        }
        if (terminalSequence !== null && nextCursor >= terminalSequence) {
          const [terminalEvent] = await db`SELECT payload_hash,payload FROM hive_task_event_inbox
            WHERE account_id=${accountId} AND task_id=${taskId} AND run_id=${task.run_id}
              AND runtime_record_id=${observation.runtimeRecordId} AND ownership_epoch=${observation.ownershipEpoch}
              AND execution_id=${observation.executionId} AND execution_epoch=${observation.executionEpoch}
              AND command_fingerprint=${observation.commandFingerprint} AND sequence=${terminalSequence}`
          if (
            !terminalEvent ||
            digest(terminalEvent.payload) !== terminalEvent.payload_hash ||
            terminalEvent.payload.status !== terminalReceipt.status ||
            digest(terminalEvent.payload.artifactRefs) !== digest(terminalReceipt.artifactRefs)
          ) {
            refuseTaskRepository('IDEMPOTENCY_CONFLICT')
          }
          task = await settle(db, accountId, taskId, runId, terminalReceipt, token, nativeDelivery)
        }
        // Expiry while SQL was waiting rolls back the inbox and all result projections.
        await requireCurrentTaskDelivery(db, accountId, task, token)
        return {
          cursor: nextCursor,
          lastSequence,
          needsReplay: nextCursor < lastSequence,
          settled: task.result_receipt !== null,
          task
        }
      })
    }
  }
}
