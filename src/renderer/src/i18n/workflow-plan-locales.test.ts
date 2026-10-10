import { expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'
import required from './en-runtime-required.json'
import { WorkflowPlanValidationRefusalSchema } from '../../../shared/task-workflow/workflow-plan-validation'

it('ships every plan label and closed rejection reason in English and Chinese', () => {
  const labels = en.hiveWorkflowCases.plans
  expect(required.hiveWorkflowCases.plans).toEqual(labels)
  expect(Object.keys(zh.hiveWorkflowCases.plans).sort()).toEqual(Object.keys(labels).sort())
  for (const reason of WorkflowPlanValidationRefusalSchema.options) {
    expect(labels.reasons[reason]).toBeTruthy()
    expect(zh.hiveWorkflowCases.plans.reasons[reason]).toBeTruthy()
    expect(zh.hiveWorkflowCases.plans.reasons[reason]).not.toBe(labels.reasons[reason])
  }
})
