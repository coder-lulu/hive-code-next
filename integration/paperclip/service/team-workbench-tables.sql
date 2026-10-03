CREATE TABLE IF NOT EXISTS hive_workbench_company_bindings (
  company_id uuid PRIMARY KEY REFERENCES companies(id),
  account_id text NOT NULL CHECK (char_length(account_id) BETWEEN 1 AND 512),
  owner_account_ref text NOT NULL CHECK (char_length(owner_account_ref) BETWEEN 1 AND 160),
  owner_actor_ref text NOT NULL CHECK (char_length(owner_actor_ref) BETWEEN 1 AND 160),
  tenant_ref text NOT NULL CHECK (char_length(tenant_ref) BETWEEN 1 AND 160),
  binding_revision bigint NOT NULL DEFAULT 1 CHECK (binding_revision BETWEEN 1 AND 9007199254740991)
);
CREATE INDEX IF NOT EXISTS hive_workbench_companies_by_account
  ON hive_workbench_company_bindings(account_id, company_id);

CREATE TABLE IF NOT EXISTS hive_workbench_project_bindings (
  project_id uuid PRIMARY KEY REFERENCES projects(id),
  company_id uuid NOT NULL REFERENCES hive_workbench_company_bindings(company_id),
  workspace_selector text NOT NULL CHECK (char_length(workspace_selector) BETWEEN 1 AND 512),
  hive_workspace_ref text NOT NULL CHECK (char_length(hive_workspace_ref) BETWEEN 1 AND 160),
  binding_revision bigint NOT NULL DEFAULT 1 CHECK (binding_revision BETWEEN 1 AND 9007199254740991),
  UNIQUE(project_id, company_id)
);
CREATE INDEX IF NOT EXISTS hive_workbench_projects_by_company
  ON hive_workbench_project_bindings(company_id, project_id);

CREATE TABLE IF NOT EXISTS hive_workbench_employee_bindings (
  employee_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  company_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('product', 'developer', 'tester', 'ops')),
  profile_ref text NOT NULL CHECK (profile_ref = 'codex'),
  profile_revision text NOT NULL CHECK (profile_revision = 'codex:1'),
  binding_revision bigint NOT NULL CHECK (binding_revision BETWEEN 1 AND 9007199254740991),
  FOREIGN KEY(company_id, employee_id) REFERENCES agents(company_id, id),
  FOREIGN KEY(project_id, company_id)
    REFERENCES hive_workbench_project_bindings(project_id, company_id),
  UNIQUE(project_id, role)
);

CREATE TABLE IF NOT EXISTS hive_workbench_request_receipts (
  account_id text NOT NULL CHECK (char_length(account_id) BETWEEN 1 AND 512),
  request_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('companies.create', 'projects.create', 'team.configure')),
  payload_fingerprint text NOT NULL CHECK (payload_fingerprint ~ '^[a-f0-9]{64}$'),
  company_id uuid NOT NULL REFERENCES hive_workbench_company_bindings(company_id),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, request_id)
);
