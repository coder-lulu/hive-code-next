CREATE TABLE IF NOT EXISTS hive_task_accounts (
  account_id text PRIMARY KEY,
  company_id uuid NOT NULL UNIQUE REFERENCES companies(id),
  agent_id uuid NOT NULL UNIQUE REFERENCES agents(id)
);
CREATE TABLE IF NOT EXISTS hive_task_bindings (
  task_id uuid PRIMARY KEY REFERENCES issues(id),
  account_id text NOT NULL REFERENCES hive_task_accounts(account_id),
  run_id uuid NOT NULL UNIQUE REFERENCES heartbeat_runs(id),
  request_id text NOT NULL,
  input_fingerprint text NOT NULL,
  workspace_selector text NOT NULL,
  binding jsonb,
  result_receipt jsonb,
  cancel_requested boolean NOT NULL DEFAULT false,
  UNIQUE(account_id, request_id)
);
CREATE INDEX IF NOT EXISTS hive_task_bindings_recovery_idx
  ON hive_task_bindings(account_id,task_id) WHERE binding IS NOT NULL AND result_receipt IS NULL;

CREATE TABLE IF NOT EXISTS hive_task_deliveries (
  task_id uuid PRIMARY KEY REFERENCES hive_task_bindings(task_id),
  account_id text NOT NULL REFERENCES hive_task_accounts(account_id),
  run_id uuid NOT NULL UNIQUE REFERENCES heartbeat_runs(id),
  protocol_version integer NOT NULL CHECK (protocol_version=1),
  runtime_record_id text NOT NULL,
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch BETWEEN 1 AND 9007199254740991),
  execution_id text NOT NULL,
  execution_epoch bigint NOT NULL CHECK (execution_epoch BETWEEN 1 AND 9007199254740991),
  command_fingerprint text NOT NULL CHECK (command_fingerprint ~ '^[0-9a-f]{64}$'),
  owner_id text NOT NULL,
  lease_ref text NOT NULL UNIQUE,
  generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  claim_kind text NOT NULL CHECK (claim_kind IN ('delivery','recovery')),
  lease_duration_ms integer NOT NULL CHECK (lease_duration_ms BETWEEN 1000 AND 60000),
  expires_at timestamptz NOT NULL,
  takeover_after timestamptz NOT NULL CHECK (takeover_after>=expires_at),
  event_cursor bigint NOT NULL DEFAULT 0 CHECK (event_cursor BETWEEN 0 AND 9007199254740991),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence BETWEEN event_cursor AND 9007199254740991),
  accepted_receipt jsonb,
  accepted_hash text,
  terminal_sequence bigint,
  terminal_receipt jsonb,
  terminal_hash text,
  CHECK ((accepted_receipt IS NULL) = (accepted_hash IS NULL)),
  CHECK (accepted_hash IS NULL OR accepted_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((terminal_sequence IS NULL) = (terminal_receipt IS NULL)),
  CHECK ((terminal_sequence IS NULL) = (terminal_hash IS NULL)),
  CHECK (terminal_hash IS NULL OR terminal_hash ~ '^[0-9a-f]{64}$'),
  CHECK (terminal_sequence IS NULL OR terminal_sequence BETWEEN 1 AND last_sequence),
  UNIQUE(task_id,account_id,run_id),
  UNIQUE(task_id,account_id,run_id,runtime_record_id,ownership_epoch,execution_id,execution_epoch,command_fingerprint)
);

CREATE TABLE IF NOT EXISTS hive_task_delivery_claim_receipts (
  lease_ref text PRIMARY KEY,
  account_id text NOT NULL,
  task_id uuid NOT NULL,
  run_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  receipt_hash text NOT NULL CHECK (receipt_hash ~ '^[0-9a-f]{64}$'),
  receipt jsonb NOT NULL,
  UNIQUE(task_id,generation),
  FOREIGN KEY(task_id,account_id,run_id) REFERENCES hive_task_deliveries(task_id,account_id,run_id)
);

CREATE TABLE IF NOT EXISTS hive_task_event_inbox (
  task_id uuid NOT NULL,
  account_id text NOT NULL,
  run_id uuid NOT NULL,
  runtime_record_id text NOT NULL,
  ownership_epoch bigint NOT NULL,
  execution_id text NOT NULL,
  execution_epoch bigint NOT NULL,
  command_fingerprint text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  PRIMARY KEY(runtime_record_id,ownership_epoch,execution_id,execution_epoch,command_fingerprint,sequence),
  FOREIGN KEY(task_id,account_id,run_id,runtime_record_id,ownership_epoch,execution_id,execution_epoch,command_fingerprint)
    REFERENCES hive_task_deliveries(task_id,account_id,run_id,runtime_record_id,ownership_epoch,execution_id,execution_epoch,command_fingerprint)
);
