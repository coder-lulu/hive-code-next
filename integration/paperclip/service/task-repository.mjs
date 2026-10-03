import { randomUUID } from 'node:crypto'
import { HiveRuntimeAdapterBinding } from '../../../src/main/tasks/paperclip-adapter-contract.ts'
import { TaskExecutionResultSchema } from '../../../src/shared/task-execution/task-execution-receipts.ts'
import { canonicalAgentSessionDigest } from '../../../src/shared/agent-session-mutation-envelope.ts'

const digest = canonicalAgentSessionDigest
const refuse = (code) => {
  throw Object.assign(new Error(code), { code })
}

/** Business state lives in the pinned Paperclip tables, with one transactional receipt per run. */
export function createTaskRepository(sql) {
  const read = async (db, accountId, taskId, lock = false) => {
    const rows = lock
      ? await db`SELECT i.*, b.run_id, b.binding, b.result_receipt, b.cancel_requested, b.workspace_selector,
          a.agent_id, h.execution_stage FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id
          JOIN heartbeat_runs h ON h.id=b.run_id
          JOIN hive_task_accounts a ON a.account_id=b.account_id WHERE b.account_id=${accountId} AND i.id=${taskId} FOR UPDATE OF i,b`
      : await db`SELECT i.*, b.run_id, b.binding, b.result_receipt, b.cancel_requested, b.workspace_selector,
          a.agent_id, h.execution_stage FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id
          JOIN heartbeat_runs h ON h.id=b.run_id
          JOIN hive_task_accounts a ON a.account_id=b.account_id WHERE b.account_id=${accountId} AND i.id=${taskId}`
    if (!rows[0]) {
      refuse('FORBIDDEN')
    }
    return rows[0]
  }
  return {
    async create(accountId, input) {
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
      return sql`SELECT i.id,i.title,i.status,i.status_version,b.run_id,b.cancel_requested,h.execution_stage,
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
    async claimDispatch(accountId, taskId) {
      return sql.begin(async (db) => {
        const task = await read(db, accountId, taskId, true)
        if (task.result_receipt) {
          return task
        }
        if (!task.binding) {
          refuse('REVISION_CONFLICT')
        }
        const [run] = await db`SELECT status FROM heartbeat_runs WHERE id=${task.run_id} FOR UPDATE`
        if (run.status !== 'queued') {
          refuse('OUTCOME_UNKNOWN')
        }
        await db`UPDATE heartbeat_runs SET status='running',started_at=now(),execution_stage='hive_dispatch' WHERE id=${task.run_id}`
        return task
      })
    },
    async cancel(accountId, taskId) {
      return sql.begin(async (db) => {
        const task = await read(db, accountId, taskId, true)
        if (task.result_receipt) {
          return task
        }
        await db`UPDATE hive_task_bindings SET cancel_requested=true WHERE task_id=${taskId}`
        // Retain checkout and business status until the Runtime supplies stopped/not-started proof.
        return read(db, accountId, taskId)
      })
    },
    async settle(accountId, taskId, rawReceipt) {
      const receipt = TaskExecutionResultSchema.parse(rawReceipt)
      return sql.begin(async (db) => {
        const task = await read(db, accountId, taskId, true)
        const binding = HiveRuntimeAdapterBinding.parse(task.binding)
        for (const key of ['runtimeRecordId', 'ownershipEpoch', 'executionId', 'executionEpoch']) {
          if (binding.command[key] !== receipt[key]) {
            refuse('IDEMPOTENCY_CONFLICT')
          }
        }
        if (binding.commandFingerprint !== receipt.commandFingerprint) {
          refuse('IDEMPOTENCY_CONFLICT')
        }
        if (task.result_receipt) {
          if (digest(task.result_receipt) !== digest(receipt)) {
            refuse('IDEMPOTENCY_CONFLICT')
          }
          return task
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
        await db`UPDATE issues SET status=${status},status_version=status_version+1,checkout_run_id=NULL,execution_locked_at=NULL,updated_at=now() WHERE id=${task.id}`
        await db`UPDATE heartbeat_runs SET status=${receipt.status},finished_at=now(),result_json=${sql.json(receipt)},execution_stage='settled',exit_code=${receipt.status === 'succeeded' ? 0 : receipt.status === 'failed' ? 1 : null} WHERE id=${task.run_id}`
        return read(db, accountId, taskId)
      })
    },
    async unknown(accountId, taskId) {
      const task = await read(sql, accountId, taskId)
      if (!task.result_receipt) {
        await sql`UPDATE heartbeat_runs SET execution_stage='outcome_unknown' WHERE id=${task.run_id} AND status='running'`
      }
    }
  }
}
