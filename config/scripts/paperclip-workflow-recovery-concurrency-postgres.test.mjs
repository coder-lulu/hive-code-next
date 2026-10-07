import crypto from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { createPostgresTaskHarness } from '../../config/scripts/paperclip-task-repository-postgres-fixture.mjs'
import { createWorkflowCasePostgresFixture } from '../../config/scripts/paperclip-workflow-cases-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from '../../integration/paperclip/service/workflow-definition-repository.mjs'
import { createWorkflowCaseRepository } from '../../integration/paperclip/service/workflow-case-repository.mjs'
import { createWorkflowCaseRunRepository } from '../../integration/paperclip/service/workflow-case-run-repository.mjs'
import { createTaskRepository } from '../../integration/paperclip/service/task-repository.mjs'
describe.skipIf(!process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG)(
  'owned PostgreSQL recovery pipeline lock isolation',
  () => {
    let h
    beforeAll(async () => {
      h = await createPostgresTaskHarness(process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG)
    })
    afterAll(async () => {
      await h?.sql.end({ timeout: 5 })
    })
    const gate = () => {
      let open
      const ready = new Promise((resolve) => {
        open = resolve
      })
      return { ready, open }
    }
    it('releases each recovery pipeline lock before the next workflow while preserving page order', async () => {
      const workbench = createTeamWorkbenchRepository(h.sql),
        workflows = createWorkflowDefinitionRepository(h.sql),
        cases = createWorkflowCaseRepository(h.sql)
      const runs = createWorkflowCaseRunRepository(h.sql)
      const f = await createWorkflowCasePostgresFixture({ workbench, workflows, cases })
      const other = await workflows.saveWorkflow(f.accountId, {
        ...f.definitionInput,
        requestId: crypto.randomUUID(),
        name: 'Second recovery workflow'
      })
      const ordered = [f.workflow, other].toSorted((a, b) => (a.workflowId < b.workflowId ? -1 : 1))
      const runIds = [`f${crypto.randomUUID().slice(1)}`, `1${crypto.randomUUID().slice(1)}`]
      for (const [index, w] of ordered.entries()) {
        const { view } = await cases.createWorkflowCase(f.accountId, {
          ...f.input,
          requestId: crypto.randomUUID(),
          workflowId: w.workflowId,
          definitionDigest: w.definitionDigest
        })
        const stage = view.stageTasks.find((t) => t.role === 'product'),
          requestId = crypto.randomUUID()
        const original = crypto.randomUUID,
          stub = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce(runIds[index])
            .mockImplementation(original)
        syncBuiltinESMExports()
        try {
          expect(
            (
              await runs.startWorkflowCase(f.accountId, {
                requestId,
                projectId: f.project.id,
                caseId: view.id,
                stageRef: stage.stageRef,
                expectedCaseRevision: view.revision,
                expectedTaskRevision: stage.taskRevision
              })
            ).run.task.runId
          ).toBe(runIds[index])
        } finally {
          stub.mockRestore()
          syncBuiltinESMExports()
        }
      }
      const lowLocked = gate(),
        scanStarted = gate(),
        scanLocked = gate(),
        pids = {}
      let scanHead
      function connection(lane) {
        let first = true
        return {
          begin: (work) =>
            h.sql.begin(async (tx) => {
              pids[lane] = (await tx`SELECT pg_backend_pid() AS pid`)[0].pid
              const db = Object.assign(
                async (strings, ...values) => {
                  const text = strings.join('?').replaceAll(/\s+/g, ' ').trim(),
                    head = first && text.startsWith('SELECT h.*')
                  if (head && lane === 'Recovery') {
                    await lowLocked.ready
                    scanHead = values[0]
                    scanStarted.open()
                  }
                  const result = await tx(strings, ...values)
                  if (head) {
                    first = false
                    if (lane === 'Recovery') {
                      scanLocked.open()
                    } else {
                      lowLocked.open()
                      await scanStarted.ready
                      await scanLocked.ready
                    }
                  }
                  return result
                },
                { json: tx.json }
              )
              return work(db)
            })
        }
      }
      const results = await Promise.allSettled([
        createWorkflowDefinitionRepository(connection('Definitions')).listWorkflows(f.accountId, {
          projectId: f.project.id
        }),
        createTaskRepository(connection('Recovery')).listRecoverableRuns(f.accountId)
      ])
      await writeFile(
        'logs/paperclip-development/p3/case-consumption/recovery-fix/actual-pg-green.json',
        JSON.stringify(
          {
            pids,
            scanHead,
            workflows: ordered.map((w) => w.workflowId),
            runIds,
            results: results.map((r) => ({
              status: r.status,
              ...(r.status === 'rejected' ? { code: r.reason.code, message: r.reason.message } : {})
            }))
          },
          null,
          2
        )
      )
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(results[1].value.items.map((t) => t.run_id)).toEqual([...runIds].sort())
      expect(scanHead).toBe(ordered[1].workflowId)
    }, 30000)
  }
)
