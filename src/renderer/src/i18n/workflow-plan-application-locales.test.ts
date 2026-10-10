import { expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'
import required from './en-runtime-required.json'
import { HiveWorkflowPlanApplicationViewSchema } from '../../../shared/hive-workflow-plan-application'

it('ships all adoption states, comparison fields and labels in English and Chinese', () => {
  const english = en.hiveWorkflowCases.planApply,
    chinese = zh.hiveWorkflowCases.planApply
  expect(required.hiveWorkflowCases.planApply).toEqual(english)
  expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort())
  const unavailable = HiveWorkflowPlanApplicationViewSchema.shape.eligibility.options[1]
  for (const reason of unavailable.shape.reason.options) {
    expect(english.reasons[reason]).toBeTruthy()
    expect(chinese.reasons[reason]).toBeTruthy()
    expect(chinese.reasons[reason]).not.toBe(english.reasons[reason])
  }
  expect(Object.keys(chinese.fields)).toEqual(Object.keys(english.fields))
})
