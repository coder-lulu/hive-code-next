DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='hive_workbench_request_receipts'::regclass
      AND conname='hive_workbench_request_receipts_operation_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%cases.create%') THEN
    ALTER TABLE hive_workbench_request_receipts
      DROP CONSTRAINT hive_workbench_request_receipts_operation_check;
    ALTER TABLE hive_workbench_request_receipts
      ADD CONSTRAINT hive_workbench_request_receipts_operation_check
      CHECK (operation IN ('companies.create','projects.create','team.configure','workflows.save','cases.create'));
  END IF;
END $$;

-- Case content, cursor, version and Issue state remain in the upstream business tables.
CREATE TABLE IF NOT EXISTS hive_workflow_case_bindings (
  case_id uuid PRIMARY KEY REFERENCES pipeline_cases(id),
  account_id text NOT NULL CHECK (char_length(account_id) BETWEEN 1 AND 512),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  workflow_revision bigint NOT NULL CHECK (workflow_revision BETWEEN 1 AND 9007199254740991),
  definition_digest text NOT NULL CHECK (definition_digest ~ '^[a-f0-9]{64}$'),
  project_binding_revision bigint NOT NULL CHECK (project_binding_revision BETWEEN 1 AND 9007199254740991),
  team_snapshot_json jsonb NOT NULL CHECK (octet_length(team_snapshot_json::text) <= 24576),
  team_snapshot_digest text NOT NULL CHECK (team_snapshot_digest ~ '^[a-f0-9]{64}$'),
  origin_issue_id uuid NOT NULL UNIQUE,
  FOREIGN KEY(workflow_id,company_id,project_id)
    REFERENCES hive_workflow_definitions(workflow_id,company_id,project_id),
  FOREIGN KEY(workflow_id,workflow_revision)
    REFERENCES hive_workflow_definition_revisions(workflow_id,revision),
  FOREIGN KEY(company_id,origin_issue_id) REFERENCES issues(company_id,id)
);
CREATE INDEX IF NOT EXISTS hive_workflow_cases_by_project
  ON hive_workflow_case_bindings(account_id,project_id,case_id);
CREATE INDEX IF NOT EXISTS hive_workflow_cases_by_workflow
  ON hive_workflow_case_bindings(account_id,project_id,workflow_id,case_id);

CREATE TABLE IF NOT EXISTS hive_workflow_case_stage_issues (
  case_id uuid NOT NULL REFERENCES hive_workflow_case_bindings(case_id),
  stage_ref text NOT NULL CHECK (char_length(stage_ref) BETWEEN 1 AND 160),
  issue_id uuid NOT NULL UNIQUE REFERENCES issues(id),
  PRIMARY KEY(case_id,stage_ref)
);

CREATE OR REPLACE FUNCTION hive_refuse_workflow_case_binding_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hive workflow case bindings are immutable' USING ERRCODE='23514';
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='hive_workflow_case_bindings'::regclass
      AND tgname='hive_workflow_case_bindings_immutable') THEN
    CREATE TRIGGER hive_workflow_case_bindings_immutable
      BEFORE UPDATE OR DELETE ON hive_workflow_case_bindings
      FOR EACH ROW EXECUTE FUNCTION hive_refuse_workflow_case_binding_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='hive_workflow_case_stage_issues'::regclass
      AND tgname='hive_workflow_case_stage_issues_immutable') THEN
    CREATE TRIGGER hive_workflow_case_stage_issues_immutable
      BEFORE UPDATE OR DELETE ON hive_workflow_case_stage_issues
      FOR EACH ROW EXECUTE FUNCTION hive_refuse_workflow_case_binding_mutation();
  END IF;
END $$;
