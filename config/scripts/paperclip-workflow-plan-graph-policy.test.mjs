import { describe, it, expect } from 'vitest'
import { planGraphTopologyReason } from '../../integration/paperclip/service/workflow-plan-graph-policy.mjs'

const task = (taskRef, requestedRole, dependsOn = []) => ({ taskRef, requestedRole, dependsOn })
describe('finite plan topology admission', () => {
  it('admits Product-only work without inventing code or reviews', () => {
    expect(planGraphTopologyReason({ tasks: [task('requirements', 'product')] })).toBeNull()
  })
  it('requires independent Tester for every Developer even without Ops', () => {
    expect(planGraphTopologyReason({ tasks: [task('code', 'developer')] })).toBe(
      'independent_review_required'
    )
  })
  it('rejects ambiguous multiple Tester approvals before queue', () => {
    expect(
      planGraphTopologyReason({
        tasks: [
          task('code', 'developer'),
          task('test-a', 'tester', ['code']),
          task('test-b', 'tester', ['code'])
        ]
      })
    ).toBe('unsupported_graph')
  })
  it('rejects an Ops task without the exact reviewed Developer dependency chain', () => {
    expect(
      planGraphTopologyReason({
        tasks: [
          task('code', 'developer'),
          task('test', 'tester', ['code']),
          task('release', 'ops', ['code'])
        ]
      })
    ).toBe('unsupported_graph')
  })
  it('allows separate independent branches but rejects their ambiguous code merge', () => {
    const tasks = [
      task('code-a', 'developer'),
      task('test-a', 'tester', ['code-a']),
      task('code-b', 'developer'),
      task('test-b', 'tester', ['code-b'])
    ]
    expect(planGraphTopologyReason({ tasks })).toBeNull()
    expect(
      planGraphTopologyReason({
        tasks: [
          ...tasks,
          task('merged-code', 'developer', ['test-a', 'test-b']),
          task('merged-test', 'tester', ['merged-code'])
        ]
      })
    ).toBe('unsupported_graph')
  })
})
