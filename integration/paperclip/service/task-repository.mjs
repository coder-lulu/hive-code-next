import { randomUUID } from 'node:crypto'
import { HiveRuntimeAdapterBinding } from '../../../src/main/tasks/paperclip-adapter-contract.ts'
import { TaskExecutionResultSchema } from '../../../src/shared/task-execution/task-execution-receipts.ts'
import { canonicalAgentSessionDigest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  assertTaskReceiptIdentity,
  createTaskDeliveryRepository,
  requireCurrentTaskDelivery,
  requireTaskDeliveryWriter,
  requireTaskRepositoryScope,
  refuseTaskRepository as refuse
} from './task-delivery-repository.mjs'
import { createTaskInboxRepository } from './task-inbox-repository.mjs'
import {
  createTaskControlRepository,
  requireExternalTaskScope
} from './task-control-repository.mjs'

const digest = canonicalAgentSessionDigest

/** Business state lives in the pinned Paperclip tables, with one transactional receipt per run. */
export function createTaskRepository(sql) {
  const read = async (db, accountId, taskId, lock = false) => {
    requireTaskRepositoryScope(accountId, taskId)
    const rows = lock
      ? await db`SELECT i.*, b.run_id, b.binding, b.result_receipt,
          (b.cancel_requested OR h.context_snapshot->'externalExecutionControl'->'cancel' IS NOT NULL) AS cancel_requested,b.workspace_selector,
          a.agent_id, h.execution_stage, h.driver_kind, h.status AS run_status FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id
          JOIN heartbeat_runs h ON h.id=b.run_id
          JOIN hive_task_accounts a ON a.account_id=b.account_id WHERE b.account_id=${accountId} AND i.id=${taskId} FOR UPDATE OF i,b`
      : await db`SELECT i.*, b.run_id, b.binding, b.result_receipt,
          (b.cancel_requested OR h.context_snapshot->'externalExecutionControl'->'cancel' IS NOT NULL) AS cancel_requested,b.workspace_selector,
          a.agent_id, h.execution_stage, h.driver_kind, h.status AS run_status FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id
          JOIN heartbeat_runs h ON h.id=b.run_id
          JOIN hive_task_accounts a ON a.account_id=b.account_id WHERE b.account_id=${accountId} AND i.id=${taskId}`
    if (!rows[0]) {
      refuse('FORBIDDEN')
    }
    return rows[0]
  }
  const persistIntent = async (db, task, kind, reason) => {
    const rows = await db`UPDATE heartbeat_runs SET context_snapshot=
    coalesce(context_snapshot,'{}'::jsonb)||jsonb_build_object('externalExecutionControl',
      coalesce(context_snapshot->'externalExecutionControl','{}'::jsonb)||jsonb_build_object(${kind}::text,
        coalesce(context_snapshot->'externalExecutionControl'->${kind}::text,
          jsonb_build_object('requestedAt',clock_timestamp(),'reason',${reason}::text))))
    WHERE id=${task.run_id} AND company_id=${task.company_id} AND driver_kind='hive_runtime' RETURNING id`
    if (!rows.length) {
      refuse('REVISION_CONFLICT')
    }
  }
  const settle = async (db, accountId, taskId, rawReceipt, token) => {
    const receipt = TaskExecutionResultSchema.parse(rawReceipt)
    const task = await read(db, accountId, taskId, true)
    const binding = assertTaskReceiptIdentity(task, receipt)
    if (task.result_receipt) {
      if (digest(task.result_receipt) !== digest(receipt)) {
        refuse('IDEMPOTENCY_CONFLICT')
      }
      return task
    }
    const delivery = await requireTaskDeliveryWriter(db, accountId, task, token)
    if (
      delivery &&
      (delivery.terminal_sequence === null ||
        Number(delivery.event_cursor) < Number(delivery.terminal_sequence) ||
        delivery.terminal_hash !== digest(receipt))
    ) {
      refuse('OUTCOME_UNKNOWN')
    }
    if (
      task.checkout_run_id !== task.run_id ||
      Number(task.status_version) !== Number(binding.command.task.taskRevision) + 1
    ) {
      refuse('REVISION_CONFLICT')
    }
    const status =
      receipt.status === 'succeeded'
        ? 'in_review'
        : receipt.status === 'cancelled'
          ? 'cancelled'
          : 'blocked'
    await db`UPDATE hive_task_bindings SET result_receipt=${sql.json(receipt)} WHERE task_id=${task.id}`
    await db`UPDATE issues SET status=${status},status_version=status_version+1,checkout_run_id=NULL,
      execution_run_id=NULL,execution_agent_name_key=NULL,execution_locked_at=NULL,updated_at=now() WHERE id=${task.id}`
    const cancelled = receipt.status === 'cancelled'
    const runs = await db`UPDATE heartbeat_runs SET status=${receipt.status},finished_at=now(),
      result_json=CASE WHEN ${cancelled}::boolean THEN
        (CASE WHEN jsonb_typeof(context_snapshot->'externalExecutionControl'->'cancel'->'resultJson')='object'
          THEN context_snapshot->'externalExecutionControl'->'cancel'->'resultJson' ELSE '{}'::jsonb END)||${sql.json(receipt)}
        ELSE ${sql.json(receipt)} END,
      error_code=CASE WHEN ${cancelled}::boolean THEN
        coalesce(context_snapshot->'externalExecutionControl'->'cancel'->>'errorCode','cancelled') ELSE error_code END,
      execution_stage='settled',exit_code=${receipt.status === 'succeeded' ? 0 : receipt.status === 'failed' ? 1 : null}
      WHERE id=${task.run_id} AND company_id=${task.company_id} AND driver_kind='hive_runtime' RETURNING id`
    if (!runs.length) {
      refuse('REVISION_CONFLICT')
    }
    const settled = await read(db, accountId, taskId)
    if (token !== undefined) {
      await requireCurrentTaskDelivery(db, accountId, settled, token)
    }
    return settled
  }
  const deliveries = createTaskDeliveryRepository(sql, read)
  const inbox = createTaskInboxRepository(sql, { read, settle })
  return {
    ...deliveries,
    ...inbox,
    ...createTaskControlRepository(sql, read),
    async create(accountId, input) {
      requireTaskRepositoryScope(accountId)
      return sql.begin(async (db) => {
        await db`SELECT pg_advisory_xact_lock(hashtextextended(${accountId}, 0))`
        const fingerprint = digest(input)
        const previous =
          await db`SELECT task_id, input_fingerprint FROM hive_task_bindings WHERE account_id=${accountId} AND request_id=${input.requestId}`
        if (previous[0]) {
          if (previous[0].input_fingerprint !== fingerprint) {
            refuse('IDEMPOTENCY_CONFLICT')
          }
          return read(db, accountId, previous[0].task_id)
        }
        let account = (await db`SELECT * FROM hive_task_accounts WHERE account_id=${accountId}`)[0]
        if (!account) {
          const companyId = randomUUID(),
            agentId = randomUUID()
          await db`INSERT INTO companies(id,name,issue_prefix,feedback_data_sharing_enabled) VALUES(${companyId},'Hive tasks',${`HIVE${digest(accountId).slice(0, 16)}`},false)`
          await db`INSERT INTO agents(id,company_id,name,adapter_type,adapter_config) VALUES(${agentId},${companyId},'Hive Runtime','hive_runtime','{}'::jsonb)`
          await db`INSERT INTO hive_task_accounts(account_id,company_id,agent_id) VALUES(${accountId},${companyId},${agentId})`
          account = { company_id: companyId, agent_id: agentId }
        }
        const taskId = randomUUID(),
          runId = randomUUID()
        const [counter] =
          await db`UPDATE companies SET issue_counter=issue_counter+1 WHERE id=${account.company_id} RETURNING issue_counter,issue_prefix`
        await db`INSERT INTO heartbeat_runs(id,company_id,agent_id,status,invocation_source,driver_kind)
          VALUES(${runId},${account.company_id},${account.agent_id},'queued','on_demand','hive_runtime')`
        await db`INSERT INTO issues(id,company_id,title,description,status,assignee_agent_id,issue_number,identifier,execution_run_id)
          VALUES(${taskId},${account.company_id},${input.title},${input.input},'todo',${account.agent_id},${counter.issue_counter},${`${counter.issue_prefix}-${counter.issue_counter}`},${runId})`
        await db`INSERT INTO hive_task_bindings(task_id,account_id,run_id,request_id,input_fingerprint,workspace_selector)
          VALUES(${taskId},${accountId},${runId},${input.requestId},${fingerprint},${input.workspaceSelector})`
        return read(db, accountId, taskId)
      })
    },
    read: (accountId, taskId) => read(sql, accountId, taskId),
    async list(accountId) {
      requireTaskRepositoryScope(accountId)
      return sql`SELECT i.id,i.title,i.status,i.status_version,b.run_id,
        (b.cancel_requested OR h.context_snapshot->'externalExecutionControl'->'cancel' IS NOT NULL) AS cancel_requested,h.execution_stage,
        CASE WHEN b.result_receipt IS NULL THEN NULL ELSE jsonb_build_object(
          'status',b.result_receipt->'status','artifactRefs',b.result_receipt->'artifactRefs') END AS result_receipt
        FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id JOIN heartbeat_runs h ON h.id=b.run_id
        WHERE b.account_id=${accountId} ORDER BY i.created_at DESC LIMIT 100`
    },
    async bind(accountId, taskId, rawBinding) {
      const binding = HiveRuntimeAdapterBinding.parse(rawBinding)
      if (
        binding.command.ownerScope.kind !== 'personalTenant' ||
        binding.command.executionPolicy.trustMode !== 'trusted_personal_preview' ||
        binding.command.profileId !== 'codex' ||
        binding.command.profileRevision !== 'codex:1' ||
        'resourceSnapshotRef' in binding.command
      ) {
        refuse('FORBIDDEN')
      }
      return sql.begin(async (db) => {
        const task = await read(db, accountId, taskId, true)
        if (task.binding) {
          const immutable = (value) => ({
            ...value,
            command: { ...value.command, expiresAt: null }
          })
          if (digest(immutable(task.binding)) !== digest(immutable(binding))) {
            refuse('IDEMPOTENCY_CONFLICT')
          }
          return task
        }
        if (
          binding.paperclipCompanyId !== task.company_id ||
          binding.paperclipAgentId !== task.agent_id ||
          binding.command.task.taskId !== task.id ||
          binding.command.task.runId !== task.run_id ||
          binding.command.task.spaceId !== task.company_id ||
          binding.command.task.taskRevision !== String(task.status_version)
        ) {
          refuse('REVISION_CONFLICT')
        }
        await db`UPDATE hive_task_bindings SET binding=${sql.json(binding)} WHERE task_id=${task.id}`
        await db`UPDATE issues SET checkout_run_id=${task.run_id},execution_locked_at=now(),status='in_progress',status_version=status_version+1 WHERE id=${task.id}`
        return read(db, accountId, taskId)
      })
    },
    async claimDispatch(accountId, taskId, token) {
      return sql.begin(async (db) => {
        const task = await read(db, accountId, taskId, true)
        if (task.result_receipt) {
          return task
        }
        if (!task.binding) {
          refuse('REVISION_CONFLICT')
        }
        await requireTaskDeliveryWriter(db, accountId, task, token)
        const [run] = await db`SELECT status FROM heartbeat_runs WHERE id=${task.run_id} FOR UPDATE`
        if (run.status !== 'queued') {
          refuse('OUTCOME_UNKNOWN')
        }
        await db`UPDATE heartbeat_runs SET status='running',started_at=now(),execution_stage='hive_dispatch' WHERE id=${task.run_id}`
        if (token !== undefined) {
          await requireCurrentTaskDelivery(db, accountId, task, token)
        }
        return task
      })
    },
    async cancel(accountId, taskId, expected) {
      return sql.begin(async (db) => {
        const task = await read(db, accountId, taskId, true)
        requireExternalTaskScope(task, expected)
        if (task.result_receipt) {
          return task
        }
        await db`UPDATE hive_task_bindings SET cancel_requested=true WHERE task_id=${taskId}`
        await persistIntent(db, task, 'cancel', 'user_requested')
        // Retain checkout and business status until the Runtime supplies stopped/not-started proof.
        return read(db, accountId, taskId)
      })
    },
    async drain(accountId, taskId, expected) {
      return sql.begin(async (db) => {
        const task = await read(db, accountId, taskId, true)
        requireExternalTaskScope(task, expected)
        if (!task.result_receipt) {
          await persistIntent(db, task, 'drain', 'delivery_shutdown')
        }
        return task
      })
    },
    async settle(accountId, taskId, rawReceipt, token) {
      requireTaskRepositoryScope(accountId, taskId)
      const receipt = TaskExecutionResultSchema.parse(rawReceipt)
      return sql.begin((db) => settle(db, accountId, taskId, receipt, token))
    },
    async unknown(accountId, taskId, token) {
      return sql.begin(async (db) => {
        const task = await read(db, accountId, taskId, true)
        if (!task.result_receipt) {
          await requireTaskDeliveryWriter(db, accountId, task, token)
          await db`UPDATE heartbeat_runs SET execution_stage='outcome_unknown' WHERE id=${task.run_id} AND status='running'`
          if (token !== undefined) {
            await requireCurrentTaskDelivery(db, accountId, task, token)
          }
        }
      })
    }
  }
}
