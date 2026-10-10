ALTER TABLE hive_workbench_request_receipts DROP CONSTRAINT IF EXISTS hive_workbench_request_receipts_operation_check;
ALTER TABLE hive_task_bindings DROP CONSTRAINT IF EXISTS hive_task_bindings_workflow_input_check;
ALTER TABLE hive_task_bindings ADD CONSTRAINT hive_task_bindings_workflow_input_check
  CHECK (workflow_input IS NULL OR octet_length(workflow_input::text) <=
    CASE WHEN workflow_input->>'graphRef' IS NOT NULL THEN 12582912 ELSE 1048576 END);
ALTER TABLE hive_workbench_request_receipts ADD CONSTRAINT hive_workbench_request_receipts_operation_check
  CHECK (operation IN ('companies.create','projects.create','team.configure','workflows.save','cases.create','plans.apply','plans.graph.start','plans.graph.cancel','plans.graph.retry','plans.graph.resume'));
CREATE TABLE IF NOT EXISTS hive_workflow_plan_graphs (
  graph_id uuid PRIMARY KEY,
  application_id uuid NOT NULL UNIQUE REFERENCES hive_workflow_plan_applications(application_id),
  control_json jsonb NOT NULL CHECK (octet_length(control_json::text)<=16384)
);
CREATE TABLE IF NOT EXISTS hive_workflow_plan_graph_outcomes (
  run_id uuid PRIMARY KEY REFERENCES heartbeat_runs(id),
  graph_id uuid NOT NULL REFERENCES hive_workflow_plan_graphs(graph_id),
  outcome_json jsonb NOT NULL CHECK (octet_length(outcome_json::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS hive_workflow_plan_graph_run_lookup ON hive_task_bindings
  ((workflow_input->>'graphRef')) WHERE workflow_input->>'graphRef' IS NOT NULL;
CREATE OR REPLACE FUNCTION hive_validate_plan_graph_control_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Hive plan graph identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.graph_id<>OLD.graph_id OR NEW.application_id<>OLD.application_id
    OR (NEW.control_json-'status'-'revision'-'pauseCause')<>(OLD.control_json-'status'-'revision'-'pauseCause')
    OR (NEW.control_json->>'revision')::bigint IS DISTINCT FROM (OLD.control_json->>'revision')::bigint+1 THEN
    RAISE EXCEPTION 'Hive plan graph identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='hive_workflow_plan_graphs'::regclass AND tgname='hive_plan_graph_control_mutation') THEN
    CREATE TRIGGER hive_plan_graph_control_mutation BEFORE UPDATE OR DELETE ON hive_workflow_plan_graphs
      FOR EACH ROW EXECUTE FUNCTION hive_validate_plan_graph_control_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='hive_workflow_plan_graph_outcomes'::regclass AND tgname='hive_plan_graph_outcomes_immutable') THEN
    CREATE TRIGGER hive_plan_graph_outcomes_immutable BEFORE UPDATE OR DELETE ON hive_workflow_plan_graph_outcomes
      FOR EACH ROW EXECUTE FUNCTION hive_refuse_workflow_case_binding_mutation();
  END IF;
END $$;
