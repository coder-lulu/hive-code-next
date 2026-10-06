import { z } from 'zod'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  HiveWorkflowCaseStartSchema,
  HiveWorkflowCaseRunSchema,
  HiveWorkflowCaseRunsSchema,
  type HiveWorkflowCaseRun,
  type HiveWorkflowCaseStart
} from '../../../../../shared/hive-workflow-case-runs'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import { TaskOpaqueRef } from '../../../../../shared/task-execution/task-execution-primitives'

const TaskProjection = z.strictObject({
  id: TaskOpaqueRef,
  runId: TaskOpaqueRef,
  title: z.string().min(1).max(240),
  status: HiveWorkflowCaseRunSchema.shape.status,
  artifactRefs: HiveWorkflowCaseRunSchema.shape.artifactRefs
})
const Artifact = z.strictObject({
  name: z.string().min(1).max(512),
  text: z.string().max(8 * 1024 * 1024)
})

export function workflowCaseRunIsActive(run: HiveWorkflowCaseRun) {
  return ['pending', 'running', 'cancelRequested', 'unknown'].includes(run.status)
}
export function createWorkflowCaseStartRequest(view: HiveWorkflowCaseView) {
  const task = view.stageTasks.find((candidate) => candidate.stageRef === view.currentStageRef)
  return HiveWorkflowCaseStartSchema.parse({
    requestId: createBrowserUuid(),
    projectId: view.binding.scope.projectRef,
    caseId: view.id,
    expectedCaseRevision: view.revision,
    stageRef: task?.stageRef,
    expectedTaskRevision: task?.taskRevision
  })
}
export type HiveWorkflowCaseRunRequest = { input: HiveWorkflowCaseStart; recoveredRunId?: string }
export function sameWorkflowCaseStart(left: HiveWorkflowCaseStart, right: HiveWorkflowCaseStart) {
  return (
    left.requestId === right.requestId &&
    left.projectId === right.projectId &&
    left.caseId === right.caseId &&
    left.stageRef === right.stageRef &&
    left.expectedCaseRevision === right.expectedCaseRevision &&
    left.expectedTaskRevision === right.expectedTaskRevision
  )
}
export function workflowCaseRequestCanReplay(
  request: HiveWorkflowCaseRunRequest | undefined,
  view: HiveWorkflowCaseView,
  runs: HiveWorkflowCaseRun[]
) {
  if (!request) {
    return false
  }
  return (
    !request.recoveredRunId ||
    runs.some(
      (run) =>
        run.task.runId === request.recoveredRunId &&
        run.stageRef === view.currentStageRef &&
        run.status === 'pending' &&
        sameWorkflowCaseStart(run.startRequest, request.input)
    )
  )
}
export function recoverWorkflowCaseRunRequest(
  request: HiveWorkflowCaseRunRequest | undefined,
  view: HiveWorkflowCaseView,
  runs: HiveWorkflowCaseRun[]
) {
  if (
    request?.recoveredRunId &&
    runs.some(
      (run) =>
        run.task.runId === request.recoveredRunId &&
        sameWorkflowCaseStart(run.startRequest, request.input) &&
        !workflowCaseRunIsActive(run)
    )
  ) {
    return undefined
  }
  if (request) {
    return request
  }
  const pending = runs.find(
    (run) => run.stageRef === view.currentStageRef && run.status === 'pending'
  )
  return pending ? { input: pending.startRequest, recoveredRunId: pending.task.runId } : undefined
}
export function workflowCaseRequestStatus(
  request: HiveWorkflowCaseRunRequest | undefined,
  view: HiveWorkflowCaseView,
  runs: HiveWorkflowCaseRun[]
) {
  return {
    uncertain: Boolean(request && !request.recoveredRunId),
    resumable: Boolean(request?.recoveredRunId && workflowCaseRequestCanReplay(request, view, runs))
  }
}
export function workflowCaseStageCanStart(view: HiveWorkflowCaseView, runs: HiveWorkflowCaseRun[]) {
  const stage = view.workflow.definition.stages.find(
    (candidate) => candidate.stageRef === view.currentStageRef
  )
  const task = view.stageTasks.find((candidate) => candidate.stageRef === view.currentStageRef)
  return Boolean(
    !view.terminalKind &&
    stage?.role === 'product' &&
    stage.dependsOn.length === 0 &&
    task?.status === 'backlog' &&
    !runs.some((run) => run.stageRef === stage.stageRef || workflowCaseRunIsActive(run))
  )
}
export function readWorkflowCaseRun(value: unknown, view: HiveWorkflowCaseView) {
  const parsed = HiveWorkflowCaseRunSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('INVALID_RESPONSE')
  }
  const run = parsed.data
  const task = view.stageTasks.find((candidate) => candidate.stageRef === run.stageRef)
  if (
    run.caseId !== view.id ||
    run.startRequest.projectId !== view.binding.scope.projectRef ||
    run.task.spaceId !== view.binding.scope.companyRef ||
    run.task.taskId !== task?.taskId ||
    run.role !== task.role ||
    run.employeeRef !== task.employeeRef ||
    new Set(run.artifactRefs).size !== run.artifactRefs.length
  ) {
    throw new Error('INVALID_RESPONSE')
  }
  return run
}
export function readWorkflowCaseRuns(value: unknown, view: HiveWorkflowCaseView) {
  const parsed = HiveWorkflowCaseRunsSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('INVALID_RESPONSE')
  }
  const runs = parsed.data.map((run) => readWorkflowCaseRun(run, view))
  if (new Set(runs.map((run) => run.task.runId)).size !== runs.length) {
    throw new Error('INVALID_RESPONSE')
  }
  return runs
}
export function mergeObservedWorkflowCaseRuns(
  previous: HiveWorkflowCaseRun[],
  received: HiveWorkflowCaseRun[]
) {
  const runs = new Map(received.map((run) => [run.task.runId, run]))
  for (const run of previous) {
    const updated = runs.get(run.task.runId)
    if (
      updated &&
      (!sameWorkflowCaseStart(updated.startRequest, run.startRequest) ||
        updated.task.attempt !== run.task.attempt)
    ) {
      throw new Error('INVALID_RESPONSE')
    }
    if (!runs.has(run.task.runId)) {
      runs.set(run.task.runId, workflowCaseRunIsActive(run) ? { ...run, status: 'unknown' } : run)
    }
  }
  if (runs.size > 96) {
    throw new Error('INVALID_RESPONSE')
  }
  return [...runs.values()]
}
export function readCancelledWorkflowCaseRun(value: unknown, run: HiveWorkflowCaseRun) {
  const parsed = TaskProjection.safeParse(value)
  if (
    !parsed.success ||
    parsed.data.id !== run.task.taskId ||
    parsed.data.runId !== run.task.runId
  ) {
    throw new Error('INVALID_RESPONSE')
  }
  return HiveWorkflowCaseRunSchema.parse({
    ...run,
    status: parsed.data.status,
    artifactRefs: parsed.data.artifactRefs
  })
}
export function readWorkflowCaseArtifact(value: unknown) {
  const parsed = Artifact.safeParse(value)
  if (!parsed.success) {
    throw new Error('INVALID_RESPONSE')
  }
  return {
    name: parsed.data.name,
    text: parsed.data.text.slice(0, 262_144),
    truncated: parsed.data.text.length > 262_144
  }
}
export type HiveWorkflowCaseArtifactPreview = ReturnType<typeof readWorkflowCaseArtifact>
