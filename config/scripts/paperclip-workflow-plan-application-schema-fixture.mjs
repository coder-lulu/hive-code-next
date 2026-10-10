import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect } from 'vitest'

/** The isolated schema and all DDL disappear with the deliberate transaction rollback. */
export async function verifyPlanApplicationSchema(sql) {
  const ddl = await readFile(
    new URL(
      '../../integration/paperclip/service/workflow-plan-application-tables.sql',
      import.meta.url
    ),
    'utf8'
  )
  const start = ddl.indexOf('CREATE TABLE IF NOT EXISTS hive_workflow_plan_applications')
  const tables = ddl.slice(start, ddl.indexOf('DO $$', start))
  const namespace = `hive_plan_schema_${randomUUID().replaceAll('-', '')}`
  await expect(
    sql.begin(async (db) => {
      await db`CREATE SCHEMA ${db(namespace)}`
      await db`SET LOCAL search_path TO ${db(namespace)},public`
      await db.unsafe(tables)
      const rows = await db`SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
      JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname=${namespace} AND t.relname IN ('hive_workflow_plan_applications','hive_workflow_plan_application_tasks')`
      expect(
        rows.some((row) =>
          row.definition.includes('source_run_id, case_id, company_id, account_id')
        )
      ).toBe(true)
      expect(
        rows.some(
          (row) =>
            row.definition.includes('application_id, company_id') &&
            row.definition.includes('FOREIGN KEY')
        )
      ).toBe(true)
      for (const field of [
        'draft_json',
        'receipt_json',
        'apply_input_json',
        'proposal_task_ref',
        'account_id'
      ]) {
        expect(
          rows.some((row) => row.definition.startsWith('CHECK') && row.definition.includes(field))
        ).toBe(true)
      }
      throw new Error('Fresh schema verified; rollback')
    })
  ).rejects.toThrow('Fresh schema verified; rollback')
  expect(await sql`SELECT oid FROM pg_namespace WHERE nspname=${namespace}`).toHaveLength(0)
}
