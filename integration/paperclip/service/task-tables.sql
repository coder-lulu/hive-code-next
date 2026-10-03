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
