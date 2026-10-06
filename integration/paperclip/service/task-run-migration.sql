DO $migration$
DECLARE
  relation regclass;
  constraint_row record;
  column_names text[];
  recovery_index record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hive.paperclip.task-run-key.v1', 0));
  LOCK TABLE hive_task_accounts, hive_task_bindings, hive_task_deliveries,
    hive_task_delivery_claim_receipts, hive_task_event_inbox IN ACCESS EXCLUSIVE MODE;

  FOR relation IN SELECT unnest(ARRAY[
    'hive_task_bindings'::regclass, 'hive_task_deliveries'::regclass
  ]) LOOP
    FOR constraint_row IN
      SELECT c.conname, c.contype, c.confrelid,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(num, ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns
      FROM pg_constraint c WHERE c.conrelid=relation AND c.contype IN ('p','f','u')
    LOOP
      column_names := constraint_row.columns;
      IF constraint_row.contype='p' AND column_names NOT IN (ARRAY['task_id'], ARRAY['run_id']) THEN
        RAISE EXCEPTION 'HIVE_TASK_RUN_PRIMARY_KEY_UNVERIFIED';
      END IF;
      IF constraint_row.contype='f' AND (
        (constraint_row.confrelid='hive_task_accounts'::regclass AND column_names=ARRAY['account_id'])
        OR (relation='hive_task_deliveries'::regclass
          AND constraint_row.confrelid='hive_task_bindings'::regclass AND column_names=ARRAY['task_id'])
      ) THEN
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', relation, constraint_row.conname);
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid='hive_task_bindings'::regclass AND c.contype='u'
      AND c.conkey=ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='task_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='account_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='run_id')
      ]::smallint[]
  ) THEN
    ALTER TABLE hive_task_bindings ADD CONSTRAINT hive_task_bindings_scope_run_key
      UNIQUE(task_id,account_id,run_id);
  END IF;

  FOR relation IN SELECT unnest(ARRAY[
    'hive_task_bindings'::regclass, 'hive_task_deliveries'::regclass
  ]) LOOP
    SELECT c.conname,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(num, ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns
      INTO constraint_row FROM pg_constraint c WHERE c.conrelid=relation AND c.contype='p';
    IF constraint_row.columns=ARRAY['task_id'] THEN
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', relation, constraint_row.conname);
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I PRIMARY KEY(run_id)',
        relation, constraint_row.conname);
    ELSIF constraint_row.columns IS DISTINCT FROM ARRAY['run_id'] THEN
      RAISE EXCEPTION 'HIVE_TASK_RUN_PRIMARY_KEY_UNVERIFIED';
    END IF;
    FOR constraint_row IN
      SELECT c.conname FROM pg_constraint c WHERE c.conrelid=relation AND c.contype='u'
        AND c.conkey=ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='run_id')
        ]::smallint[]
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', relation, constraint_row.conname);
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid='hive_task_deliveries'::regclass
      AND c.contype='f' AND c.confrelid='hive_task_bindings'::regclass
      AND c.conkey=ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='task_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='account_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='run_id')
      ]::smallint[]
      AND c.confkey=ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='task_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='account_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='run_id')
      ]::smallint[]
  ) THEN
    ALTER TABLE hive_task_deliveries ADD CONSTRAINT hive_task_deliveries_binding_run_fkey
      FOREIGN KEY(task_id,account_id,run_id) REFERENCES hive_task_bindings(task_id,account_id,run_id);
  END IF;

  FOR constraint_row IN
    SELECT c.conname FROM pg_constraint c WHERE c.conrelid='hive_task_delivery_claim_receipts'::regclass
      AND c.contype='u' AND c.conkey=ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='task_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='generation')
      ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE hive_task_delivery_claim_receipts DROP CONSTRAINT %I',
      constraint_row.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid='hive_task_delivery_claim_receipts'::regclass
      AND c.contype='u' AND c.conkey=ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='run_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='generation')
      ]::smallint[]
  ) THEN
    ALTER TABLE hive_task_delivery_claim_receipts
      ADD CONSTRAINT hive_task_delivery_claim_receipts_run_generation_key UNIQUE(run_id,generation);
  END IF;

  -- Match the run cursor so bounded account recovery pages do not repeatedly sort task history.
  SELECT i.indrelid,i.indnkeyatts,i.indnatts,i.indisunique,i.indisvalid,am.amname,
    pg_get_expr(i.indpred,i.indrelid) AS predicate,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(num,ord)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY k.ord) AS columns
    INTO recovery_index FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      JOIN pg_am am ON am.oid=c.relam
    WHERE i.indexrelid=to_regclass('hive_task_bindings_recovery_idx');
  IF FOUND THEN
    IF recovery_index.indrelid<>'hive_task_bindings'::regclass OR recovery_index.indnkeyatts<>2
      OR recovery_index.indnatts<>2 OR recovery_index.indisunique OR NOT recovery_index.indisvalid
      OR recovery_index.amname<>'btree'
      OR recovery_index.predicate IS DISTINCT FROM '((binding IS NOT NULL) AND (result_receipt IS NULL))'
      OR recovery_index.columns NOT IN (ARRAY['account_id','task_id'],ARRAY['account_id','run_id']) THEN
      RAISE EXCEPTION 'HIVE_TASK_RECOVERY_INDEX_UNVERIFIED';
    END IF;
    IF recovery_index.columns=ARRAY['account_id','task_id'] THEN
      DROP INDEX hive_task_bindings_recovery_idx;
      CREATE INDEX hive_task_bindings_recovery_idx ON hive_task_bindings(account_id,run_id)
        WHERE binding IS NOT NULL AND result_receipt IS NULL;
    END IF;
  ELSE
    CREATE INDEX hive_task_bindings_recovery_idx ON hive_task_bindings(account_id,run_id)
      WHERE binding IS NOT NULL AND result_receipt IS NULL;
  END IF;
END;
$migration$;
