import { z } from 'zod'
import { canonicalAgentSessionDigest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { HiveRuntimeAdapterBinding } from '../../../src/main/tasks/paperclip-adapter-contract.ts'
import { TaskDeliveryTokenSchema as TaskDeliveryToken } from '../../../src/shared/task-execution/task-command-delivery.ts'
export { TaskDeliveryToken }
import {
  TaskCounter,
  TaskDigest,
  TaskOpaqueRef
} from '../../../src/shared/task-execution/task-execution-primitives.ts'

const LeaseDuration = z.number().int().min(1000).max(60_000)
const Claim = z.strictObject({
  ownerId: TaskOpaqueRef,
  leaseRef: TaskOpaqueRef,
  expectedGeneration: TaskCounter.max(Number.MAX_SAFE_INTEGER - 1),
  leaseMs: LeaseDuration
})
const RecoveryClaim = Claim.extend({ commandFingerprint: TaskDigest })
const Renewal = TaskDeliveryToken.extend({ leaseMs: LeaseDuration })
const Page = z.strictObject({
  after: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(32)
})
export const refuseTaskRepository = (code) => {
  throw Object.assign(new Error(code), { code })
}

export function requireTaskRepositoryScope(accountId, ...ids) {
  if (typeof accountId !== 'string' || !accountId || accountId.length > 512) {
    refuseTaskRepository('FORBIDDEN')
  }
  for (const id of ids) {
    z.string().uuid().parse(id)
  }
}

export function taskDeliveryBinding(task) {
  const binding = HiveRuntimeAdapterBinding.parse(task.binding)
  if (
    binding.paperclipCompanyId !== task.company_id ||
    binding.paperclipAgentId !== task.agent_id ||
    binding.command.task.taskId !== task.id ||
    binding.command.task.runId !== task.run_id ||
    binding.command.task.spaceId !== task.company_id
  ) {
    refuseTaskRepository('IDEMPOTENCY_CONFLICT')
  }
  return binding
}

export function assertTaskReceiptIdentity(task, receipt) {
  const binding = taskDeliveryBinding(task)
  for (const key of [
    'protocolVersion',
    'runtimeRecordId',
    'ownershipEpoch',
    'executionId',
    'executionEpoch'
  ]) {
    if (binding.command[key] !== receipt[key]) {
      refuseTaskRepository('IDEMPOTENCY_CONFLICT')
    }
  }
  if (binding.commandFingerprint !== receipt.commandFingerprint) {
    refuseTaskRepository('IDEMPOTENCY_CONFLICT')
  }
  return binding
}

const counter = (value) => TaskCounter.parse(Number(value))
const timestamp = (value) => new Date(value).toISOString()
function deliveryFromRow(row, accountId, task) {
  const binding = taskDeliveryBinding(task)
  assertTaskReceiptIdentity(task, {
    protocolVersion: row.protocol_version,
    runtimeRecordId: row.runtime_record_id,
    ownershipEpoch: counter(row.ownership_epoch),
    executionId: row.execution_id,
    executionEpoch: counter(row.execution_epoch),
    commandFingerprint: row.command_fingerprint
  })
  return {
    accountId,
    companyId: task.company_id,
    taskId: task.id,
    runId: task.run_id,
    ownerId: row.owner_id,
    leaseRef: row.lease_ref,
    generation: counter(row.generation),
    serverNow: timestamp(row.server_now),
    expiresAt: timestamp(row.expires_at),
    cursor: counter(row.event_cursor),
    protocolVersion: binding.command.protocolVersion,
    runtimeRecordId: binding.command.runtimeRecordId,
    ownershipEpoch: binding.command.ownershipEpoch,
    executionId: binding.command.executionId,
    executionEpoch: binding.command.executionEpoch,
    commandFingerprint: binding.commandFingerprint,
    operationId: binding.command.operationId,
    workspaceExecutionClaimRef: binding.command.workspaceExecutionClaimRef,
    writeFence: binding.command.writeFence
  }
}

export async function requireCurrentTaskDelivery(db, accountId, task, rawToken) {
  const token = TaskDeliveryToken.parse(rawToken)
  const [row] = await db`SELECT *, clock_timestamp() AS server_now FROM hive_task_deliveries
    WHERE account_id=${accountId} AND task_id=${task.id} AND run_id=${task.run_id}
      AND owner_id=${token.ownerId} AND lease_ref=${token.leaseRef}
      AND generation=${token.generation} AND expires_at>clock_timestamp() FOR UPDATE`
  if (!row) {
    refuseTaskRepository('OUTCOME_UNKNOWN')
  }
  deliveryFromRow(row, accountId, task)
  return row
}

export async function requireTaskDeliveryWriter(db, accountId, task, rawToken) {
  if (rawToken !== undefined) {
    return requireCurrentTaskDelivery(db, accountId, task, rawToken)
  }
  const rows = await db`SELECT task_id FROM hive_task_deliveries
    WHERE account_id=${accountId} AND task_id=${task.id} AND run_id=${task.run_id}`
  if (rows.length) {
    refuseTaskRepository('OUTCOME_UNKNOWN')
  }
  return null
}

export function createTaskDeliveryRepository(sql, read) {
  const recordClaim = async (db, accountId, task, requestHash, row) => {
    const receipt = deliveryFromRow(row, accountId, task)
    await db`INSERT INTO hive_task_delivery_claim_receipts(
        lease_ref,account_id,task_id,run_id,generation,request_hash,receipt_hash,receipt)
      VALUES(${receipt.leaseRef},${accountId},${task.id},${task.run_id},${receipt.generation},
        ${requestHash},${canonicalAgentSessionDigest(receipt)},${db.json(receipt)})`
    return receipt
  }
  const claim = async (accountId, taskId, runId, rawInput, recovering) => {
    requireTaskRepositoryScope(accountId, taskId, runId)
    const input = (recovering ? RecoveryClaim : Claim).parse(rawInput)
    return sql
      .begin(async (db) => {
        const task = await read(db, accountId, taskId, runId, true)
        const binding = taskDeliveryBinding(task)
        if (recovering && input.commandFingerprint !== binding.commandFingerprint) {
          refuseTaskRepository('IDEMPOTENCY_CONFLICT')
        }
        const requestHash = canonicalAgentSessionDigest({
          accountId,
          taskId,
          runId: task.run_id,
          commandFingerprint: binding.commandFingerprint,
          kind: recovering ? 'recovery' : 'delivery',
          input
        })
        const [previousClaim] =
          await db`SELECT request_hash,receipt_hash,receipt,clock_timestamp() AS server_now
        FROM hive_task_delivery_claim_receipts
        WHERE account_id=${accountId} AND task_id=${taskId} AND run_id=${task.run_id} AND lease_ref=${input.leaseRef}`
        if (previousClaim) {
          const receipt = previousClaim.receipt
          if (
            previousClaim.request_hash !== requestHash ||
            previousClaim.receipt_hash !== canonicalAgentSessionDigest(receipt) ||
            receipt.accountId !== accountId ||
            receipt.companyId !== task.company_id ||
            receipt.taskId !== taskId ||
            receipt.runId !== task.run_id ||
            receipt.ownerId !== input.ownerId ||
            receipt.leaseRef !== input.leaseRef ||
            receipt.generation !== input.expectedGeneration + 1 ||
            receipt.operationId !== binding.command.operationId ||
            receipt.workspaceExecutionClaimRef !== binding.command.workspaceExecutionClaimRef ||
            receipt.writeFence !== binding.command.writeFence
          ) {
            refuseTaskRepository('IDEMPOTENCY_CONFLICT')
          }
          assertTaskReceiptIdentity(task, receipt)
          // The immutable claim response cannot renew a lease or overwrite a newer owner.
          return { ...receipt, serverNow: timestamp(previousClaim.server_now) }
        }
        if (task.result_receipt) {
          refuseTaskRepository('REVISION_CONFLICT')
        }
        const [previous] =
          await db`SELECT *, clock_timestamp() AS server_now FROM hive_task_deliveries
        WHERE account_id=${accountId} AND task_id=${taskId} AND run_id=${runId} FOR UPDATE`
        if (previous) {
          deliveryFromRow(previous, accountId, task)
          if (previous.lease_ref === input.leaseRef) {
            refuseTaskRepository('OUTCOME_UNKNOWN')
          }
          if (counter(previous.generation) !== input.expectedGeneration) {
            refuseTaskRepository('OUTCOME_UNKNOWN')
          }
          const rows = recovering
            ? await db`WITH lease_clock AS MATERIALIZED (SELECT clock_timestamp() AS server_now)
            UPDATE hive_task_deliveries SET owner_id=${input.ownerId},lease_ref=${input.leaseRef},
              generation=generation+1,claim_kind='recovery',lease_duration_ms=${input.leaseMs},
              expires_at=lease_clock.server_now+${input.leaseMs}*interval '1 millisecond',
              takeover_after=lease_clock.server_now+${input.leaseMs}*interval '1 millisecond'
            FROM lease_clock
            WHERE account_id=${accountId} AND task_id=${taskId} AND run_id=${runId} AND generation=${input.expectedGeneration}
              AND lease_ref=${previous.lease_ref} AND command_fingerprint=${input.commandFingerprint}
            RETURNING hive_task_deliveries.*,lease_clock.server_now`
            : await db`WITH lease_clock AS MATERIALIZED (SELECT clock_timestamp() AS server_now)
            UPDATE hive_task_deliveries SET owner_id=${input.ownerId},lease_ref=${input.leaseRef},
              generation=generation+1,claim_kind='delivery',lease_duration_ms=${input.leaseMs},
              expires_at=lease_clock.server_now+${input.leaseMs}*interval '1 millisecond',
              takeover_after=lease_clock.server_now+${input.leaseMs}*interval '1 millisecond'
            FROM lease_clock
            WHERE account_id=${accountId} AND task_id=${taskId} AND run_id=${runId} AND generation=${input.expectedGeneration}
              AND lease_ref=${previous.lease_ref} AND expires_at<=lease_clock.server_now AND takeover_after<=lease_clock.server_now
            RETURNING hive_task_deliveries.*,lease_clock.server_now`
          if (!rows[0]) {
            refuseTaskRepository('OUTCOME_UNKNOWN')
          }
          return recordClaim(db, accountId, task, requestHash, rows[0])
        }
        if (input.expectedGeneration !== 0) {
          refuseTaskRepository('OUTCOME_UNKNOWN')
        }
        const command = binding.command
        const [row] =
          await db`WITH lease_clock AS MATERIALIZED (SELECT clock_timestamp() AS server_now)
        INSERT INTO hive_task_deliveries(
          task_id,account_id,run_id,protocol_version,runtime_record_id,ownership_epoch,execution_id,execution_epoch,
          command_fingerprint,owner_id,lease_ref,generation,claim_kind,lease_duration_ms,expires_at,takeover_after)
        SELECT ${taskId},${accountId},${task.run_id},${command.protocolVersion},${command.runtimeRecordId},
          ${command.ownershipEpoch},${command.executionId},${command.executionEpoch},${binding.commandFingerprint},
          ${input.ownerId},${input.leaseRef},1,${recovering ? 'recovery' : 'delivery'},${input.leaseMs},
          lease_clock.server_now+${input.leaseMs}*interval '1 millisecond',
          lease_clock.server_now+${input.leaseMs}*interval '1 millisecond' FROM lease_clock
        RETURNING *, (SELECT server_now FROM lease_clock) AS server_now`
        return recordClaim(db, accountId, task, requestHash, row)
      })
      .catch((error) => {
        if (error.code === '23505') {
          refuseTaskRepository('IDEMPOTENCY_CONFLICT')
        }
        throw error
      })
  }
  return {
    claimDelivery: (accountId, taskId, runId, input) =>
      claim(accountId, taskId, runId, input, false),
    // Trusted Dispatcher only: revoke old Runtime start authority for this bound tuple/fingerprint first.
    // This CAS validates database ownership; it does not authenticate or manufacture host proof.
    claimRecoveryDelivery: (accountId, taskId, runId, input) =>
      claim(accountId, taskId, runId, input, true),
    async renewDelivery(accountId, taskId, runId, rawInput) {
      requireTaskRepositoryScope(accountId, taskId, runId)
      const input = Renewal.parse(rawInput)
      return sql.begin(async (db) => {
        const task = await read(db, accountId, taskId, runId, true)
        if (task.result_receipt) {
          refuseTaskRepository('REVISION_CONFLICT')
        }
        const [row] =
          await db`WITH lease_clock AS MATERIALIZED (SELECT clock_timestamp() AS server_now)
          UPDATE hive_task_deliveries
          SET expires_at=lease_clock.server_now+${input.leaseMs}*interval '1 millisecond',
            takeover_after=GREATEST(takeover_after,lease_clock.server_now+${input.leaseMs}*interval '1 millisecond')
          FROM lease_clock
          WHERE account_id=${accountId} AND task_id=${taskId} AND run_id=${runId} AND owner_id=${input.ownerId}
            AND lease_ref=${input.leaseRef} AND generation=${input.generation}
            AND expires_at>lease_clock.server_now RETURNING hive_task_deliveries.*,lease_clock.server_now`
        if (!row) {
          refuseTaskRepository('OUTCOME_UNKNOWN')
        }
        return deliveryFromRow(row, accountId, task)
      })
    },
    async releaseDelivery(accountId, taskId, runId, rawToken) {
      requireTaskRepositoryScope(accountId, taskId, runId)
      const token = TaskDeliveryToken.parse(rawToken)
      return sql.begin(async (db) => {
        const task = await read(db, accountId, taskId, runId, true)
        const [row] = await db`UPDATE hive_task_deliveries
          SET expires_at=LEAST(expires_at,clock_timestamp())
          WHERE account_id=${accountId} AND task_id=${taskId} AND run_id=${runId} AND owner_id=${token.ownerId}
            AND lease_ref=${token.leaseRef} AND generation=${token.generation}
          RETURNING *, clock_timestamp() AS server_now`
        if (!row) {
          refuseTaskRepository('OUTCOME_UNKNOWN')
        }
        return deliveryFromRow(row, accountId, task)
      })
    },
    async getCurrentDelivery(accountId, companyId, runId) {
      requireTaskRepositoryScope(accountId, companyId, runId)
      const [row] = await sql`SELECT d.*,b.task_id AS id,b.run_id,b.binding,a.company_id,a.agent_id,
          clock_timestamp() AS server_now FROM hive_task_bindings b
        JOIN hive_task_accounts a ON a.account_id=b.account_id
        JOIN issues i ON i.id=b.task_id AND i.company_id=a.company_id
        JOIN heartbeat_runs h ON h.id=b.run_id AND h.company_id=i.company_id AND h.agent_id=a.agent_id
          AND h.driver_kind='hive_runtime'
        JOIN agents g ON g.id=h.agent_id AND g.company_id=i.company_id
        LEFT JOIN hive_task_deliveries d ON d.task_id=b.task_id AND d.account_id=b.account_id AND d.run_id=b.run_id
        WHERE b.account_id=${accountId} AND a.company_id=${companyId} AND b.run_id=${runId}`
      if (!row) {
        refuseTaskRepository('FORBIDDEN')
      }
      return row.generation == null ? null : deliveryFromRow(row, accountId, row)
    },
    async listRecoverableRuns(accountId, rawQuery = {}) {
      requireTaskRepositoryScope(accountId)
      const query = Page.parse(rawQuery)
      const rows = await sql`SELECT i.id,a.company_id,a.agent_id,b.run_id,b.binding,
          (b.cancel_requested OR h.context_snapshot->'externalExecutionControl'->'cancel' IS NOT NULL) AS cancel_requested,
          h.status AS run_status,h.execution_stage,d.generation,d.lease_ref,d.owner_id,d.expires_at
        FROM hive_task_bindings b JOIN hive_task_accounts a ON a.account_id=b.account_id
        JOIN issues i ON i.id=b.task_id AND i.company_id=a.company_id
        JOIN heartbeat_runs h ON h.id=b.run_id AND h.company_id=a.company_id AND h.agent_id=a.agent_id
        JOIN agents g ON g.id=h.agent_id AND g.company_id=i.company_id
        LEFT JOIN hive_task_deliveries d ON d.task_id=b.task_id AND d.account_id=b.account_id AND d.run_id=b.run_id
        WHERE b.account_id=${accountId} AND b.binding IS NOT NULL AND b.result_receipt IS NULL
          AND h.driver_kind='hive_runtime' AND (${query.after ?? null}::uuid IS NULL OR b.run_id>${query.after ?? null}::uuid)
        ORDER BY b.run_id ASC LIMIT ${query.limit + 1}`
      const items = rows.slice(0, query.limit)
      for (const task of items) {
        taskDeliveryBinding(task)
      }
      return { items, nextCursor: rows.length > query.limit ? items.at(-1).run_id : null }
    }
  }
}
