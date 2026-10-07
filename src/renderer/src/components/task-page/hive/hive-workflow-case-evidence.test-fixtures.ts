import { HiveWorkflowCaseViewSchema } from '../../../../../shared/hive-workflow-cases'
import {
  WorkflowHandoffSchema,
  WorkflowReviewSchema
} from '../../../../../shared/task-workflow/workflow-evidence'
import { workflowTestVectors } from '../../../../../shared/task-workflow/workflow.test-fixture'
import { workbenchId } from './hive-workbench.test-fixtures'
import { executableWorkflowCase, workflowCaseRun } from './hive-workflow-case-run.test-fixtures'

// Presentation-only fixture; it does not prove native execution or artifact contents.
export function workflowCaseEvidenceFixture(
  decision: 'approved' | 'changes_requested' | 'rejected' = 'changes_requested'
) {
  const original = executableWorkflowCase()
  const developer = original.stageTasks.find((task) => task.role === 'developer')!
  const tester = original.stageTasks.find((task) => task.role === 'tester')!
  const ops = original.stageTasks.find((task) => task.role === 'ops')!
  const developerRun = workflowCaseRun(
    { ...original, currentStageRef: developer.stageRef },
    'succeeded',
    workbenchId(910)
  )
  const testerRun = workflowCaseRun(
    { ...original, currentStageRef: tester.stageRef },
    decision === 'approved' ? 'succeeded' : 'failed',
    workbenchId(911)
  )
  const example = workflowTestVectors.examples.handoff
  const codeVersion = {
    kind: 'snapshot' as const,
    snapshot: example.artifact,
    treeDigest: 'd'.repeat(64)
  }
  const implementation = WorkflowHandoffSchema.parse({
    ...example,
    handoffRef: 'handoff:implementation',
    binding: original.binding,
    stageRef: developer.stageRef,
    producer: {
      ...example.producer,
      employeeRef: developer.employeeRef,
      role: 'developer',
      task: developerRun.task
    },
    consumer: { stageRef: tester.stageRef, employeeRef: tester.employeeRef, role: 'tester' },
    codeVersion,
    dependencyVersions: [],
    audienceScope: { scope: original.binding.scope, employeeRefs: [tester.employeeRef] }
  })
  const consumer = decision === 'approved' ? ops : developer
  const tested = WorkflowHandoffSchema.parse({
    ...implementation,
    handoffRef: 'handoff:tests',
    stageRef: tester.stageRef,
    producer: {
      ...example.producer,
      employeeRef: tester.employeeRef,
      role: 'tester',
      task: testerRun.task
    },
    consumer: {
      stageRef: consumer.stageRef,
      employeeRef: consumer.employeeRef,
      role: consumer.role
    },
    artifact: { ...example.artifact, artifactRef: 'artifact:test-report' },
    summary: 'Tests found a regression. Return this code version to development.',
    audienceScope: { scope: original.binding.scope, employeeRefs: [consumer.employeeRef] }
  })
  const review = WorkflowReviewSchema.parse({
    contractVersion: 1,
    kind: 'workflow.review',
    reviewRef: 'review:tests',
    binding: original.binding,
    stageRef: tester.stageRef,
    subjectHandoffRef: implementation.handoffRef,
    artifact: implementation.artifact,
    codeVersion,
    reviewer: tested.producer,
    decision,
    testReport: tested.artifact
  })
  const view = HiveWorkflowCaseViewSchema.parse({
    ...original,
    handoffs: [implementation, tested],
    reviews: [review]
  })
  return {
    view,
    developerRun: { ...developerRun, artifactRefs: [implementation.artifact.artifactRef] },
    testerRun: { ...testerRun, artifactRefs: [tested.artifact.artifactRef] },
    implementation,
    tested,
    review
  }
}
