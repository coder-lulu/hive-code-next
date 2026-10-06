import { randomUUID } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { refuseWorkbench } from './team-workbench-repository-records.mjs'
import {
  workflowStageKey,
  workflowPipelineStageConfig,
  readWorkflowProjectEmployees
} from './workflow-pipeline-policy.mjs'

export function workflowPipelineStages(definition, employees) {
  const identity = {
    contractVersion: 1,
    workflowRef: definition.workflowRef,
    workflowRevision: definition.workflowRevision
  }
  return [
    ...definition.stages.map((stage, index) => ({
      key: workflowStageKey(stage.stageRef),
      name: `${stage.role} ${index + 1}`,
      kind: stage.role === 'tester' ? 'review' : 'working',
      position: index,
      config: workflowPipelineStageConfig(definition, stage, employees)
    })),
    ...['done', 'cancelled'].map((kind, index) => ({
      key: kind,
      name: kind === 'done' ? 'Release prepared' : 'Cancelled',
      kind,
      position: definition.stages.length + index,
      config: { hiveWorkflow: { ...identity, terminalKind: kind } }
    }))
  ]
}

export function workflowPipelineTransitions(definition) {
  const key = workflowStageKey
  const edges = new Map()
  const add = (from, to, label) => edges.set(JSON.stringify([from, to]), { from, to, label })
  for (const stage of definition.stages) {
    for (const dependency of stage.dependsOn) {
      add(key(dependency), key(stage.stageRef), 'handoff')
    }
    if (stage.returnToStageRef) {
      add(key(stage.stageRef), key(stage.returnToStageRef), 'request_changes')
    }
    add(key(stage.stageRef), 'cancelled', 'cancel_requested')
    if (stage.role === 'ops') {
      add(key(stage.stageRef), 'done', 'release_prepared')
    }
  }
  return [...edges.values()]
}

/** Each immutable definition revision is a real upstream Pipeline graph, without automation config. */
export async function createWorkflowPipeline(db, snapshot, pipelineId, actorRef, employees) {
  const definition = snapshot.definition
  const stages = workflowPipelineStages(definition, employees).map((stage) => ({
    ...stage,
    id: randomUUID()
  }))
  await db`INSERT INTO pipelines(id,company_id,project_id,key,name,enforce_transitions,created_by_user_id)
    VALUES(${pipelineId},${definition.scope.companyRef},${definition.scope.projectRef},
      ${`hive_${snapshot.workflowId}_r${definition.workflowRevision}`},${snapshot.name},true,${actorRef})`
  for (const stage of stages) {
    await db`INSERT INTO pipeline_stages(id,pipeline_id,key,name,kind,position,config)
      VALUES(${stage.id},${pipelineId},${stage.key},${stage.name},${stage.kind},${stage.position},${db.json(stage.config)})`
  }
  const ids = new Map(stages.map((stage) => [stage.key, stage.id]))
  for (const edge of workflowPipelineTransitions(definition)) {
    await db`INSERT INTO pipeline_transitions(pipeline_id,from_stage_id,to_stage_id,label)
      VALUES(${pipelineId},${ids.get(edge.from)},${ids.get(edge.to)},${edge.label})`
  }
}

export async function assertWorkflowPipeline(db, snapshot, pipeline) {
  const definition = snapshot.definition
  const employees = await readWorkflowProjectEmployees(db, definition.scope)
  if (
    pipeline.company_id !== definition.scope.companyRef ||
    pipeline.project_id !== definition.scope.projectRef ||
    pipeline.name !== snapshot.name ||
    pipeline.key !== `hive_${snapshot.workflowId}_r${definition.workflowRevision}` ||
    pipeline.enforce_transitions !== true ||
    pipeline.archived_at !== null
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  const stages = await db`SELECT id,key,name,kind,position,config FROM pipeline_stages
    WHERE pipeline_id=${pipeline.id} ORDER BY position,key FOR SHARE`
  if (
    digest(stages.map(({ id: _id, ...stage }) => stage)) !==
    digest(workflowPipelineStages(definition, employees))
  ) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
  const keys = new Map(stages.map((stage) => [stage.id, stage.key]))
  const edges = await db`SELECT from_stage_id,to_stage_id,label FROM pipeline_transitions
    WHERE pipeline_id=${pipeline.id} FOR SHARE`
  const sort = (rows) => rows.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const actual = edges.map((edge) => ({
    from: keys.get(edge.from_stage_id),
    to: keys.get(edge.to_stage_id),
    label: edge.label
  }))
  if (digest(sort(actual)) !== digest(sort(workflowPipelineTransitions(definition)))) {
    return refuseWorkbench('REVISION_CONFLICT')
  }
}
