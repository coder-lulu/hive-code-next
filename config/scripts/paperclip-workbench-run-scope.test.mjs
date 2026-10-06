import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTaskRunScopeReader } from '../../integration/paperclip/service/task-run-scope.mjs'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { runScopeFixture } from './paperclip-workbench-run-scope-fixture.mjs'

function fixture(personal = false) {
  const f = runScopeFixture(personal)
  const reader = createTaskRunScopeReader(f.sql)
  return {
    ...f,
    reader,
    read: (lock = false) => reader.read(f.sql, f.accountId, f.taskId, f.runId, lock)
  }
}

describe('persistent Paperclip run authority for personal tasks and Workbench Cases', () => {
  it('authorizes a real Case run without creating a personal company or employee mapping', async () => {
    const f = fixture()
    const task = await f.read()
    expect(task.id).toBe(f.taskId)
    expect(task.run_scope).toMatchObject({
      kind: 'workbenchCase',
      accountId: f.accountId,
      companyId: f.companyId,
      projectId: f.projectId,
      caseId: f.caseId,
      stageRef: f.stage.stageRef,
      employeeRef: f.employee.employeeRef,
      role: 'developer',
      profileId: 'codex',
      profileRevision: 'codex:1',
      workspaceRef: f.team.project.hiveWorkspaceRef,
      projectBindingRevision: 2
    })
    expect(f.calls.every(({ text }) => text.startsWith('SELECT'))).toBe(true)
  })

  it('retains the personal account/company/real-run-agent proof', async () => {
    const f = fixture(true)
    expect((await f.read()).run_scope).toMatchObject({
      kind: 'personal',
      accountId: f.accountId,
      companyId: f.companyId,
      employeeRef: f.task.agent_id
    })
    expect(f.calls).toHaveLength(2)
    f.task.personal_agent_id = randomUUID()
    await expect(f.read()).rejects.toThrow('FORBIDDEN')
  })

  it.each(['account', 'task', 'run'])('rejects a foreign %s tuple', async (part) => {
    const f = fixture()
    await expect(
      f.reader.read(
        f.sql,
        part === 'account' ? 'foreign' : f.accountId,
        part === 'task' ? randomUUID() : f.taskId,
        part === 'run' ? randomUUID() : f.runId
      )
    ).rejects.toThrow('FORBIDDEN')
  })

  it.each(['owner_account_ref', 'owner_actor_ref', 'tenant_ref'])(
    'rejects tampered company %s',
    async (field) => {
      const f = fixture()
      f.caseRow[field] = 'foreign:owner'
      await expect(f.read()).rejects.toThrow('FORBIDDEN')
    }
  )

  it.each(['run_company_id', 'agent_company_id', 'driver_kind'])(
    'rejects a changed persisted %s',
    async (field) => {
      const f = fixture()
      f.task[field] = field === 'driver_kind' ? 'local_process' : randomUUID()
      await expect(f.read()).rejects.toThrow('FORBIDDEN')
    }
  )

  it.each([
    'company_id',
    'project_id',
    'case_company_id',
    'origin_company_id',
    'origin_project_id',
    'origin_link_company_id',
    'link_company_id',
    'revision_company_id',
    'revision_project_id',
    'revision_pipeline_id',
    'pipeline_company_id',
    'pipeline_project_id'
  ])('fails closed on changed Case %s', async (field) => {
    const f = fixture()
    f.caseRow[field] = randomUUID()
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })

  it.each([
    'case_retired_at',
    'link_retired_at',
    'origin_link_retired_at',
    'pipeline_archived_at',
    'origin_parent_id'
  ])('rejects changed live Case %s', async (field) => {
    const f = fixture()
    f.caseRow[field] = field === 'origin_parent_id' ? randomUUID() : new Date()
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })

  it.each(['workspace_selector', 'hive_workspace_ref', 'revision_digest', 'definition_digest'])(
    'rejects changed persisted %s',
    async (field) => {
      const f = fixture()
      f.caseRow[field] = 'foreign:binding'
      await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
    }
  )

  it('does not authorize an arbitrary employee from the four-employee snapshot', async () => {
    const f = fixture()
    f.task.agent_id = f.team.employees.find((employee) => employee.role === 'tester').employeeRef
    f.task.binding.paperclipAgentId = f.task.agent_id
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })

  it.each([
    { agent_adapter_type: 'codex_local' },
    { agent_role: 'qa' },
    { agent_adapter_config: { command: 'foreign:driver' } }
  ])('rechecks real Agent configuration after project locks', async (change) => {
    const f = fixture()
    const original = f.sql.getMockImplementation()
    f.sql.mockImplementation(async (strings, ...values) => {
      if (strings.join('').startsWith('SELECT cb.case_id')) {
        Object.assign(f.task, change)
      }
      return original(strings, ...values)
    })
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
    expect(f.calls.at(-1).text).toContain('FROM agents')
  })

  it('refuses a missing owned Case instead of falling back to a personal mapping', async () => {
    const f = fixture()
    f.caseRow.missing = true
    f.task.personal_company_id = f.companyId
    f.task.personal_agent_id = f.task.agent_id
    await expect(f.read()).rejects.toThrow('FORBIDDEN')
  })

  it('uses historical run identity after Issue reassignment and later team revisions', async () => {
    const f = fixture()
    f.task.assignee_agent_id = randomUUID()
    f.caseRow.project_revision = 9
    const task = await f.read()
    expect(task.agent_id).toBe(f.employee.employeeRef)
    expect(task.run_scope.projectBindingRevision).toBe(2)
    expect(f.calls.some(({ text }) => text.includes('hive_workbench_employee_bindings'))).toBe(true)
  })

  it.each(['role', 'profileRef', 'profileRevision', 'bindingRevision'])(
    'rejects snapshot employee %s drift with a recomputed digest',
    async (field) => {
      const f = fixture()
      const employee = f.caseRow.team_snapshot_json.employees.find(
        (item) => item.role === 'developer'
      )
      employee[field] = field === 'bindingRevision' ? 99 : 'foreign:profile'
      f.refreshTeamDigest()
      await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
    }
  )

  it('rejects owner changes within a schema-valid snapshot even with a new digest', async () => {
    const f = fixture()
    f.caseRow.team_snapshot_json.company.ownerAccountRef = 'account:foreign'
    f.refreshTeamDigest()
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })

  it('validates snapshot schemas and team digest on every read', async () => {
    const f = fixture()
    await f.read()
    f.caseRow.team_snapshot_json.employees[0].profileRef = 'codex:tampered'
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
    f.refreshTeamDigest()
    f.caseRow.team_snapshot_json.granted = true
    f.refreshTeamDigest()
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })

  it('rejects a malformed exact historical stage projection', async () => {
    const f = fixture()
    f.caseRow.snapshot_definition.stages.find(
      (stage) => stage.stageRef === f.task.stage_ref
    ).acceptanceCriteria = []
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
    expect(f.calls.at(-1).text).toContain('v.revision=cb.workflow_revision')
  })

  it.each([
    'snapshot_workflow_id',
    'snapshot_workflow_ref',
    'snapshot_revision',
    'snapshot_digest',
    'stage_pipeline_id',
    'stage_key',
    'stage_kind'
  ])('rejects historical stage %s drift', async (field) => {
    const f = fixture()
    f.caseRow[field] = field === 'snapshot_revision' ? 99 : 'foreign:definition'
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })

  it('rejects mutable pipeline stage edits even when they retain the same stage key', async () => {
    const f = fixture()
    f.caseRow.stage_config.hiveWorkflow.stage.role = 'tester'
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })

  it('rejects duplicate stage projections rather than accepting the first match', async () => {
    const f = fixture()
    f.caseRow.snapshot_definition.stages.push(
      structuredClone(f.caseRow.snapshot_definition.stages[0])
    )
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })

  it('rejects a missing exact historical stage', async () => {
    const f = fixture()
    f.task.stage_ref = 'stage:foreign'
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })

  it.each(['paperclipCompanyId', 'paperclipAgentId'])(
    'rejects binding %s tampering',
    async (field) => {
      const f = fixture()
      f.task.binding[field] = randomUUID()
      await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
    }
  )

  it.each(['profileId', 'profileRevision', 'workspaceRef'])(
    'rejects a changed command %s',
    async (field) => {
      const f = fixture()
      f.task.binding.command[field] = 'foreign:command'
      await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
    }
  )

  it('rejects a Case command that downgrades to personal preview execution', async () => {
    const f = fixture()
    f.task.binding.command.executionPolicy = {
      trustMode: 'trusted_personal_preview',
      executionPolicyRef: 'policy:scope-fixture',
      executionPolicyRevision: 'policy:1'
    }
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })
  it('validates pending Case run authority before an execution binding exists', async () => {
    const f = fixture()
    f.task.binding = null
    expect((await f.read()).run_scope.employeeRef).toBe(f.employee.employeeRef)
  })

  it('resolves controls and delivery reads from the persisted tuple, ignoring private context claims', async () => {
    const f = fixture()
    f.task.context_snapshot = { accountId: 'foreign', taskId: randomUUID(), scopeAuthorized: true }
    const task = await f.reader.resolve(f.sql, f.companyId, f.runId, f.accountId)
    expect(task.account_id).toBe(f.accountId)
    expect(task.id).toBe(f.taskId)
    expect(f.calls[0].text).toContain('h.id=b.run_id')
    expect(f.calls[0].text).not.toContain('context_snapshot')
    await expect(f.reader.resolve(f.sql, randomUUID(), f.runId)).rejects.toThrow('FORBIDDEN')
    await expect(f.reader.resolve(f.sql, f.companyId, f.runId, 'foreign')).rejects.toThrow(
      'FORBIDDEN'
    )
  })

  it('cannot use private JSON or a coincidental personal mapping to bypass Case ownership', async () => {
    const f = fixture()
    f.task.context_snapshot = { accountId: f.accountId, scopeAuthorized: true }
    f.task.personal_company_id = f.companyId
    f.task.personal_agent_id = f.task.agent_id
    f.caseRow.owner_actor_ref = 'actor:foreign'
    await expect(f.read()).rejects.toThrow('FORBIDDEN')
  })

  it('validates the complete original definition and selects the exact historical stage on every read', async () => {
    const f = fixture()
    await f.read()
    await f.read()
    await f.reader.resolve(f.sql, f.companyId, f.runId)
    expect(f.calls.filter(({ text }) => text.startsWith('SELECT r.definition_json'))).toHaveLength(
      3
    )
    expect(f.calls.filter(({ text }) => text.includes('ORDER BY r.stage_ref'))).toHaveLength(0)
    expect(
      f.calls
        .filter(({ text }) => text.startsWith('SELECT cb.case_id'))
        .every(({ text }) =>
          text.includes("v.definition_json->'definition' AS snapshot_definition")
        )
    ).toBe(true)
    expect(f.calls.filter(({ text }) => text.startsWith('SELECT cb.case_id'))).toHaveLength(3)
  })

  it('locks the exact Issue/run binding before returning writer authority', async () => {
    const f = fixture()
    await f.read(true)
    expect(f.calls[0].text).not.toContain('FOR ')
    expect(f.calls[1].text).toContain('FOR SHARE OF c,cb,p,pb')
    const issueLock = f.calls.find(({ text }) => text.includes('FOR UPDATE OF i,b'))
    expect(issueLock).toBeDefined()
    expect(issueLock.values).toEqual([f.accountId, f.taskId, f.runId])
    expect(f.calls.indexOf(issueLock)).toBeGreaterThan(1)
  })

  it('locks the persisted project before Issue/run or Agent locks for ordinary polling', async () => {
    const f = fixture()
    await f.read()
    const locks = f.calls.filter(
      ({ text }) => text.includes('FOR SHARE') || text.includes('FOR UPDATE')
    )
    expect(locks[0].text).toContain('FOR SHARE OF c,cb,p,pb')
    const issueLock = locks.findIndex(({ text }) => text.includes('FOR SHARE OF i,b,h'))
    const revisionLock = locks.findIndex(({ text }) => text.includes('FOR UPDATE OF p'))
    expect(revisionLock).toBeGreaterThan(0)
    expect(issueLock).toBeGreaterThan(revisionLock)
    expect(locks.at(-1).text).toContain('FROM agents')
  })

  it('rechecks Issue scope after the persisted project has been locked', async () => {
    const f = fixture()
    const original = f.sql.getMockImplementation()
    f.sql.mockImplementation(async (strings, ...values) => {
      if (strings.join('').startsWith('SELECT c.id AS company_id')) {
        f.task.project_id = randomUUID()
      }
      return original(strings, ...values)
    })
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
    expect(f.calls.at(-1).text).toContain('FOR SHARE OF i,b,h')
    expect(f.calls.some(({ text }) => text.startsWith('SELECT cb.case_id'))).toBe(false)
  })

  it('rejects invalid input before issuing any SQL', async () => {
    const f = fixture()
    await expect(f.reader.read(f.sql, '', f.taskId, f.runId)).rejects.toThrow('FORBIDDEN')
    await expect(f.reader.read(f.sql, f.accountId, 'invalid', f.runId)).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
  })

  it('rejects a historical digest mismatch even when snapshot content is otherwise valid', async () => {
    const f = fixture()
    f.caseRow.definition_digest = digest({ other: true })
    f.caseRow.revision_digest = f.caseRow.definition_digest
    await expect(f.read()).rejects.toThrow('REVISION_CONFLICT')
  })
})
