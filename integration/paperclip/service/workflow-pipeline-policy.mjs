import { z } from 'zod'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  WORKBENCH_UPSTREAM_ROLES,
  refuseWorkbench as refuse
} from './team-workbench-repository-records.mjs'

const roles = ['product', 'developer', 'tester', 'ops']
export const workflowStageKey = (ref) => `stage_${digest(ref)}`

/** Native orchestration currently supports one four-role chain and its Tester return edge. */
export function linearWorkflowStages(definition) {
  const stages = roles.map((role) => definition.stages.find((stage) => stage.role === role))
  if (
    definition.stages.length !== 4 ||
    stages.some((stage) => !stage) ||
    stages.some(
      (stage, index) =>
        digest(stage.dependsOn) !== digest(index ? [stages[index - 1].stageRef] : []) ||
        stage.returnToStageRef !== (stage.role === 'tester' ? stages[1].stageRef : undefined)
    )
  ) {
    return null
  }
  return stages
}

export function requireLinearWorkflowDefinition(definition) {
  const stages = linearWorkflowStages(definition)
  if (!stages) {
    refuse('CAPABILITY_UNAVAILABLE')
  }
  return stages
}

function requireWorkflowEmployees(employees, scope, code) {
  if (
    employees.length !== 4 ||
    new Set(employees.map((employee) => employee.employeeRef)).size !== 4 ||
    roles.some((role) => employees.filter((employee) => employee.role === role).length !== 1) ||
    employees.some(
      (employee) =>
        !z.string().uuid().safeParse(employee.employeeRef).success ||
        employee.scope.companyRef !== scope.companyRef ||
        employee.scope.projectRef !== scope.projectRef
    )
  ) {
    refuse(code)
  }
  return employees
}

export function workflowPipelineStageConfig(definition, stage, employees) {
  const stages = linearWorkflowStages(definition)
  const executable = stages !== null && employees.length === 4
  if (employees.length) {
    requireWorkflowEmployees(employees, definition.scope, 'REVISION_CONFLICT')
  }
  return {
    hiveWorkflow: {
      contractVersion: 1,
      workflowRef: definition.workflowRef,
      workflowRevision: definition.workflowRevision,
      stage
    },
    ...(executable && stage.role === 'tester'
      ? {
          requireApproval: true,
          approver: {
            kind: 'agent',
            id: employees.find((employee) => employee.role === 'tester').employeeRef
          },
          approveToStageKey: workflowStageKey(stages[3].stageRef),
          rejectToStageKey: workflowStageKey(stages[1].stageRef),
          requestChangesToStageKey: workflowStageKey(stages[1].stageRef),
          requireRejectReason: true,
          requireRequestChangesReason: true
        }
      : {})
  }
}

/** Call only after the authorized project lock; current profile/name revisions do not replace identity. */
export async function readWorkflowProjectEmployees(db, scope) {
  const rows =
    await db`SELECT a.id AS employee_id,a.role AS upstream_role,a.adapter_type,a.adapter_config,
    b.company_id,b.project_id,b.role,b.binding_revision,pb.binding_revision AS project_revision
    FROM hive_workbench_employee_bindings b JOIN agents a ON a.id=b.employee_id AND a.company_id=b.company_id
    JOIN hive_workbench_project_bindings pb ON pb.project_id=b.project_id AND pb.company_id=b.company_id
    WHERE b.company_id=${scope.companyRef} AND b.project_id=${scope.projectRef}
    ORDER BY b.role LIMIT 5 FOR SHARE OF a,b,pb`
  if (
    rows.some(
      (row) =>
        row.upstream_role !== WORKBENCH_UPSTREAM_ROLES[row.role] ||
        row.adapter_type !== 'hive_runtime' ||
        digest(row.adapter_config) !== digest({}) ||
        Number(row.binding_revision) !== Number(row.project_revision)
    )
  ) {
    refuse('REVISION_CONFLICT')
  }
  if (rows.length === 0) {
    return []
  }
  return requireWorkflowEmployees(
    rows.map((row) => ({
      role: row.role,
      employeeRef: row.employee_id,
      scope: { companyRef: row.company_id, projectRef: row.project_id }
    })),
    scope,
    'REVISION_CONFLICT'
  )
}

export async function assertCurrentWorkflowEmployees(db, scope, frozen) {
  requireWorkflowEmployees(frozen, scope, 'REVISION_CONFLICT')
  const current = await readWorkflowProjectEmployees(db, scope)
  if (
    frozen.some(
      (employee) =>
        current.find((member) => member.role === employee.role)?.employeeRef !==
        employee.employeeRef
    )
  ) {
    refuse('REVISION_CONFLICT')
  }
}
