import { createWorkflowDraft, type WorkflowStage } from './hive-workflow-draft'

export function graphStages(): WorkflowStage[] {
  const original = createWorkflowDraft((key) => key).stages
  const refs = ['product', 'developer', 'tester', 'ops']
  return original.map((stage, index) => ({
    ...stage,
    stageRef: refs[index],
    dependsOn: index ? [refs[index - 1]] : [],
    ...(index === 2 ? { returnToStageRef: refs[1] } : {})
  }))
}

export function branchingGraphStages(): WorkflowStage[] {
  const [product, developer, tester, ops] = graphStages()
  const second = { ...developer, stageRef: 'developer-other' }
  return [
    { ...ops, dependsOn: ['tester', 'product'] },
    second,
    product,
    { ...tester, dependsOn: ['developer', 'developer-other'] },
    developer
  ]
}
