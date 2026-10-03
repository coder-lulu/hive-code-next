import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkflowTeamBindingSchema } from './workflow-bindings'
import { WorkflowDefinitionSchema, workflowDefinitionRefusal } from './workflow-definition'
import { WorkflowHandoffSchema, WorkflowSharedEventSchema } from './workflow-evidence'
import { WorkflowSchemas, taskWorkflowJsonSchema } from './workflow-contract'
import { workflowTestVectors as vectors } from './workflow.test-fixture'

const team = WorkflowTeamBindingSchema.parse(vectors.examples.team)
const definition = WorkflowDefinitionSchema.parse(vectors.examples.definition)
const handoff = WorkflowHandoffSchema.parse(vectors.examples.handoff)
const sharedEvent = WorkflowSharedEventSchema.parse(vectors.examples.sharedEvent)

describe('frozen engineering workflow contract', () => {
  it('publishes the exact JSON schema generated from the validators', () => {
    expect(
      JSON.parse(
        readFileSync(resolve('integration/contracts/workflow-v1/task-workflow.schema.json'), 'utf8')
      )
    ).toEqual(taskWorkflowJsonSchema())
  })

  it('accepts the complete fixed contract examples', () => {
    expect(WorkflowSchemas.CompanyBinding.safeParse(team.company).success).toBe(true)
    expect(WorkflowSchemas.ProjectBinding.safeParse(team.project).success).toBe(true)
    for (const employee of team.employees) {
      expect(WorkflowSchemas.EmployeeBinding.safeParse(employee).success).toBe(true)
    }
    expect(WorkflowSchemas.Review.safeParse(vectors.examples.review).success).toBe(true)
    expect(WorkflowSchemas.DeploymentApproval.safeParse(vectors.examples.approval).success).toBe(
      true
    )
  })

  it.each(['command', 'env', 'model', 'provider', 'cwd', 'principal', 'authorizationRef'])(
    'rejects injected employee field %s',
    (field) => {
      expect(
        WorkflowSchemas.EmployeeBinding.safeParse({ ...team.employees[0], [field]: 'unsafe' })
          .success
      ).toBe(false)
    }
  )
  it.each(['process', 'codex_local', 'http', 'claude_local'])(
    'rejects upstream executor %s',
    (adapterType) => {
      expect(
        WorkflowSchemas.EmployeeBinding.safeParse({ ...team.employees[0], adapterType }).success
      ).toBe(false)
    }
  )
  it('allows one managed profile while requiring four distinct employees and roles', () => {
    expect(new Set(team.employees.map((employee) => employee.profileRevision)).size).toBe(1)
    const sameEmployee = structuredClone(team)
    sameEmployee.employees[2].employeeRef = sameEmployee.employees[1].employeeRef
    expect(WorkflowTeamBindingSchema.safeParse(sameEmployee).success).toBe(false)
    const sameRole = structuredClone(team)
    sameRole.employees[2].role = 'developer'
    expect(WorkflowTeamBindingSchema.safeParse(sameRole).success).toBe(false)
  })
  it('rejects project substitutions and incomplete teams', () => {
    const changed = structuredClone(team)
    changed.employees[1].scope.projectRef = 'project:other'
    expect(WorkflowTeamBindingSchema.safeParse(changed).success).toBe(false)
    expect(
      WorkflowTeamBindingSchema.safeParse({ ...team, employees: team.employees.slice(0, 3) })
        .success
    ).toBe(false)
  })
  it.each(['privateContext', 'transcript', 'credentials', 'toolConfig', 'operationCallerKey'])(
    'does not broadcast private field %s in a handoff or event',
    (field) => {
      expect(WorkflowHandoffSchema.safeParse({ ...handoff, [field]: 'private' }).success).toBe(
        false
      )
      expect(
        WorkflowSharedEventSchema.safeParse({ ...sharedEvent, [field]: 'private' }).success
      ).toBe(false)
    }
  )
  it('requires code versions for developer handoffs and a bounded scoped audience', () => {
    const { codeVersion: _codeVersion, ...withoutCode } = handoff
    expect(WorkflowHandoffSchema.safeParse(withoutCode).success).toBe(false)
    expect(
      WorkflowHandoffSchema.safeParse({
        ...handoff,
        audienceScope: { ...handoff.audienceScope, employeeRefs: ['employee:developer'] }
      }).success
    ).toBe(false)
    expect(
      WorkflowSharedEventSchema.safeParse({
        ...sharedEvent,
        audienceScope: {
          ...sharedEvent.audienceScope,
          scope: { ...sharedEvent.binding.scope, projectRef: 'project:other' }
        }
      }).success
    ).toBe(false)
  })
})

describe('finite workflow definition', () => {
  it('accepts the product-development-test-ops chain', () => {
    expect(workflowDefinitionRefusal(definition)).toBeNull()
  })
  it.each([
    [
      'workflow_duplicate_stage',
      (stages: typeof definition.stages) => {
        stages[1].stageRef = stages[0].stageRef
      }
    ],
    [
      'workflow_unknown_dependency',
      (stages: typeof definition.stages) => {
        stages[1].dependsOn = ['stage:unknown']
      }
    ],
    [
      'workflow_duplicate_dependency',
      (stages: typeof definition.stages) => {
        stages[1].dependsOn.push(stages[1].dependsOn[0])
      }
    ],
    [
      'workflow_dependency_cycle',
      (stages: typeof definition.stages) => {
        stages[0].dependsOn = [stages[3].stageRef]
      }
    ],
    [
      'workflow_dependency_cycle',
      (stages: typeof definition.stages) => {
        stages[1].dependsOn = [stages[1].stageRef]
      }
    ],
    [
      'workflow_test_dependency_required',
      (stages: typeof definition.stages) => {
        stages[2].dependsOn = [stages[0].stageRef]
      }
    ],
    [
      'workflow_test_dependency_required',
      (stages: typeof definition.stages) => {
        stages[3].dependsOn = [stages[1].stageRef]
      }
    ]
  ])('rejects invalid dependency graph: %s', (reason, mutate) => {
    const changed = structuredClone(definition)
    mutate(changed.stages)
    expect(workflowDefinitionRefusal(changed)).toBe(reason)
    expect(WorkflowDefinitionSchema.safeParse(changed).success).toBe(false)
  })
  it('rejects excessive work before parsing any stages', () => {
    const stages = Array.from({ length: 33 }, () => null)
    Object.defineProperty(stages, 0, {
      get: () => {
        throw new Error('oversized stage was parsed')
      }
    })
    expect(WorkflowDefinitionSchema.safeParse({ ...definition, stages }).success).toBe(false)
  })
  it.each([
    { maxParallelism: 5 },
    { maxDurationMs: 0 },
    { maxDurationMs: Infinity },
    { workflowRevision: 0 }
  ])('rejects unbounded or malformed workflow limits %j', (patch) => {
    expect(WorkflowDefinitionSchema.safeParse({ ...definition, ...patch }).success).toBe(false)
  })
  it('requires bounded attempts and explicit acceptance criteria', () => {
    const changed = structuredClone(definition)
    changed.stages[1].maxAttempts = 4
    expect(WorkflowDefinitionSchema.safeParse(changed).success).toBe(false)
    changed.stages[1].maxAttempts = 2
    changed.stages[1].acceptanceCriteria = []
    expect(WorkflowDefinitionSchema.safeParse(changed).success).toBe(false)
  })
  it('requires the expected output and a developer return target for test failures', () => {
    const changed = structuredClone(definition)
    changed.stages[2].outputKind = 'release_plan'
    expect(workflowDefinitionRefusal(changed)).toBe('workflow_output_mismatch')
    changed.stages[2].outputKind = 'test_report'
    changed.stages[2].returnToStageRef = 'stage:ops'
    expect(workflowDefinitionRefusal(changed)).toBe('workflow_return_stage_invalid')
    changed.stages[2].returnToStageRef = 'stage:product'
    expect(workflowDefinitionRefusal(changed)).toBe('workflow_return_stage_invalid')
    delete changed.stages[2].returnToStageRef
    expect(workflowDefinitionRefusal(changed)).toBe('workflow_return_stage_invalid')
  })
})
