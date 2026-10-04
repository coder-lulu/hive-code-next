DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='hive_workbench_request_receipts'::regclass
      AND conname='hive_workbench_request_receipts_operation_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%workflows.save%') THEN
    ALTER TABLE hive_workbench_request_receipts
      DROP CONSTRAINT hive_workbench_request_receipts_operation_check;
    ALTER TABLE hive_workbench_request_receipts
      ADD CONSTRAINT hive_workbench_request_receipts_operation_check
      CHECK (operation IN ('companies.create','projects.create','team.configure','workflows.save'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hive_workflow_definitions (
  workflow_id uuid PRIMARY KEY REFERENCES pipelines(id),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  latest_revision bigint NOT NULL CHECK (latest_revision BETWEEN 1 AND 9007199254740991),
  FOREIGN KEY(project_id,company_id)
    REFERENCES hive_workbench_project_bindings(project_id,company_id),
  UNIQUE(workflow_id,company_id,project_id)
);
CREATE INDEX IF NOT EXISTS hive_workflow_definitions_by_project
  ON hive_workflow_definitions(project_id,workflow_id);

CREATE TABLE IF NOT EXISTS hive_workflow_definition_revisions (
  workflow_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  pipeline_id uuid NOT NULL UNIQUE REFERENCES pipelines(id),
  definition_json jsonb NOT NULL CHECK (octet_length(definition_json::text) <= 98304),
  definition_digest text NOT NULL CHECK (definition_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workflow_id,revision),
  FOREIGN KEY(workflow_id,company_id,project_id)
    REFERENCES hive_workflow_definitions(workflow_id,company_id,project_id)
);

CREATE OR REPLACE FUNCTION hive_refuse_workflow_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hive workflow definition revisions are immutable' USING ERRCODE='23514';
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='hive_workflow_definition_revisions'::regclass
      AND tgname='hive_workflow_revisions_immutable') THEN
    CREATE TRIGGER hive_workflow_revisions_immutable
      BEFORE UPDATE OR DELETE ON hive_workflow_definition_revisions
      FOR EACH ROW EXECUTE FUNCTION hive_refuse_workflow_revision_mutation();
  END IF;
END $$;
