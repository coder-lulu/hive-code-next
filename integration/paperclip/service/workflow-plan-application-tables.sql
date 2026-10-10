DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='hive_workbench_request_receipts'::regclass
    AND conname='hive_workbench_request_receipts_operation_check' AND pg_get_constraintdef(oid) NOT LIKE '%plans.apply%') THEN
    ALTER TABLE hive_workbench_request_receipts DROP CONSTRAINT hive_workbench_request_receipts_operation_check;
    ALTER TABLE hive_workbench_request_receipts ADD CONSTRAINT hive_workbench_request_receipts_operation_check
      CHECK (operation IN ('companies.create','projects.create','team.configure','workflows.save','cases.create','plans.apply'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS hive_workflow_plan_intent_application_scope
  ON hive_workflow_plan_intents(run_id,case_id,company_id,account_id);
CREATE TABLE IF NOT EXISTS hive_workflow_plan_applications (
  application_id uuid PRIMARY KEY,
  case_id uuid NOT NULL UNIQUE,
  company_id uuid NOT NULL,
  account_id text NOT NULL CHECK (char_length(account_id) BETWEEN 1 AND 512),
  source_run_id uuid NOT NULL REFERENCES hive_workflow_plan_intents(run_id),
  apply_input_json jsonb NOT NULL CHECK (octet_length(apply_input_json::text) <= 8192),
  draft_json jsonb NOT NULL CHECK (octet_length(draft_json::text) <= 262144),
  draft_digest text NOT NULL CHECK (draft_digest ~ '^[a-f0-9]{64}$'),
  receipt_json jsonb NOT NULL CHECK (octet_length(receipt_json::text) <= 98304),
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY(case_id,company_id,account_id)
    REFERENCES hive_workflow_case_bindings(case_id,company_id,account_id),
  FOREIGN KEY(source_run_id,case_id,company_id,account_id)
    REFERENCES hive_workflow_plan_intents(run_id,case_id,company_id,account_id),
  UNIQUE(application_id,company_id)
);
CREATE TABLE IF NOT EXISTS hive_workflow_plan_application_tasks (
  application_id uuid NOT NULL REFERENCES hive_workflow_plan_applications(application_id),
  proposal_task_ref text NOT NULL CHECK (char_length(proposal_task_ref) BETWEEN 1 AND 160),
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL UNIQUE,
  employee_id uuid NOT NULL,
  PRIMARY KEY(application_id,proposal_task_ref),
  FOREIGN KEY(application_id,company_id) REFERENCES hive_workflow_plan_applications(application_id,company_id),
  FOREIGN KEY(company_id,issue_id) REFERENCES issues(company_id,id),
  FOREIGN KEY(company_id,employee_id) REFERENCES agents(company_id,id)
);
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['hive_workflow_plan_applications','hive_workflow_plan_application_tasks'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=name::regclass AND tgname=name||'_immutable') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hive_refuse_workflow_case_binding_mutation()',name||'_immutable',name);
    END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION hive_refuse_plan_request_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.operation='plans.apply' OR (TG_OP='UPDATE' AND NEW.operation='plans.apply') THEN
    RAISE EXCEPTION 'Hive plan request receipts are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='hive_workbench_request_receipts'::regclass
    AND tgname='hive_plan_requests_immutable') THEN
    CREATE TRIGGER hive_plan_requests_immutable BEFORE UPDATE OR DELETE ON hive_workbench_request_receipts
      FOR EACH ROW EXECUTE FUNCTION hive_refuse_plan_request_mutation();
  END IF;
END $$;
