import { describe, expect, it } from 'vitest'
import { selectWorkflowRoleArtifact, workflowRoleReportNames } from './workflow-role-artifacts'

describe('immutable role artifact selection', () => {
  it.each([...Object.values(workflowRoleReportNames), 'review.json'] as const)(
    'retains the original nested %s member',
    (name) => {
      const member = { name: `deliverables/v1/${name}`, version: { digest: 'original' } }
      expect(selectWorkflowRoleArtifact([member], name)).toBe(member)
    }
  )
  it('does not guess a missing or differently cased report', () => {
    expect(
      selectWorkflowRoleArtifact([{ name: 'Implementation.md' }], 'implementation.md')
    ).toBeUndefined()
  })
  it('rejects root and nested candidates instead of preferring root', () => {
    expect(() =>
      selectWorkflowRoleArtifact(
        [{ name: 'implementation.md' }, { name: 'v1/implementation.md' }],
        'implementation.md'
      )
    ).toThrow('ambiguous')
  })
  it.each([
    '/implementation.md',
    'C:/implementation.md',
    'x\\implementation.md',
    './implementation.md',
    '../implementation.md',
    'x//implementation.md',
    'x/../implementation.md',
    'x/./implementation.md',
    'x/\0implementation.md',
    ''
  ])('rejects unsafe manifest path %s', (name) => {
    expect(() => selectWorkflowRoleArtifact([{ name }], 'implementation.md')).toThrow(
      'path_invalid'
    )
  })
})
