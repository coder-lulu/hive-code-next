import { describe, expect, it } from 'vitest'
import { capacityGraph } from './hive-workflow-plan-graph-capacity.test-fixture'
import {
  hiveWorkflowPlanGraphContext,
  hiveWorkflowPlanGraphPrompt
} from './hive-workflow-plan-graph-context'
import { WorkflowReviewProposalSchema } from './task-workflow/workflow-review-proposal'

describe('adopted task role completion instructions', () => {
  it('gives the Tester the original structured review and independent runner contract', () => {
    const { source, view } = capacityGraph(1)
    const task = view.tasks[1]
    const context = hiveWorkflowPlanGraphContext(
      source.caseView,
      view,
      task.proposalTaskRef,
      task.latestRun!
    )
    const prompt = JSON.parse(
      hiveWorkflowPlanGraphPrompt(source.caseView, view, task.proposalTaskRef, context)
    )
    expect(prompt.roleCompletion).toContain('positive test count')
    expect(prompt.roleCompletion).toContain('own exec_command tool call with cwd /workspace')
    expect(prompt.roleCompletion).toContain(
      'node --test, npm/pnpm/yarn test, vitest/jest, pytest, go/cargo/dotnet/mvn/gradle test'
    )
    expect(prompt.roleCompletion).toContain('Do not combine the runner with cd')
    const json = prompt.roleCompletion
      .split('\n')
      .find((line: string) => line.startsWith('{"contractVersion":1'))
    const review = WorkflowReviewProposalSchema.parse(JSON.parse(json))
    expect(review.testedCodeVersion).toEqual(context.codeInput!.version)
    expect(review.decision).toBe('changes_requested')
    expect(review).not.toHaveProperty('producer')
    expect(review).not.toHaveProperty('subjectHandoffRef')
    expect(prompt.context.codeInput.producer).toEqual(view.outcomes[2].producer)
    expect(prompt.context.planExecution.dependencyOutcomes[0].outcomeRef).toBe(
      view.outcomes[2].outcomeRef
    )
    expect(prompt.roleCompletion).toContain('test-report.md')
    expect(prompt.roleCompletion).toContain('review.json')
  })
})
