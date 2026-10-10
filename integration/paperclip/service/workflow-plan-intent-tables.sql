CREATE UNIQUE INDEX IF NOT EXISTS hive_workflow_case_binding_plan_scope
  ON hive_workflow_case_bindings(case_id,company_id,account_id);
CREATE TABLE IF NOT EXISTS hive_workflow_plan_intents (
  run_id uuid PRIMARY KEY REFERENCES heartbeat_runs(id),
  intent_ref uuid NOT NULL UNIQUE,
  case_id uuid NOT NULL REFERENCES hive_workflow_case_bindings(case_id),
  company_id uuid NOT NULL,
  account_id text NOT NULL,
  task_id uuid NOT NULL,
  stage_ref text NOT NULL,
  plan_revision bigint NOT NULL CHECK (plan_revision BETWEEN 1 AND 9007199254740991),
  intent_json jsonb NOT NULL CHECK (octet_length(intent_json::text) <= 24576),
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  UNIQUE(case_id,plan_revision),
  FOREIGN KEY(case_id,company_id,account_id)
    REFERENCES hive_workflow_case_bindings(case_id,company_id,account_id),
  FOREIGN KEY(company_id,task_id) REFERENCES issues(company_id,id),
  FOREIGN KEY(case_id,stage_ref) REFERENCES hive_workflow_case_stage_issues(case_id,stage_ref),
  FOREIGN KEY(task_id,account_id,run_id) REFERENCES hive_task_bindings(task_id,account_id,run_id)
    DEFERRABLE INITIALLY DEFERRED
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='hive_workflow_plan_intents'::regclass
    AND tgname='hive_workflow_plan_intents_immutable') THEN
    CREATE TRIGGER hive_workflow_plan_intents_immutable
      BEFORE UPDATE OR DELETE ON hive_workflow_plan_intents
      FOR EACH ROW EXECUTE FUNCTION hive_refuse_workflow_case_binding_mutation();
  END IF;
END $$;
