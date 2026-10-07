import { describe, expect, it } from 'vitest'
import { workflowTestVectors } from './workflow.test-fixture'
import { WorkflowReviewProposalSchema } from './workflow-review-proposal'

function proposal() {
  return {
    contractVersion: 1,
    kind: 'workflow.review-proposal',
    decision: 'approved',
    summary: 'The referenced commands exercised the supplied code.',
    testedCodeVersion: workflowTestVectors.examples.handoff.codeVersion
  }
}
describe('review proposals without authority or fabricated native provenance', () => {
  it('preserves an explicit decision and its tested version', () => {
    expect(WorkflowReviewProposalSchema.parse(proposal())).toEqual(proposal())
  })
  it.each([
    'actor',
    'reviewer',
    'producer',
    'authorized',
    'stopProof',
    'passed',
    'path',
    'commandCallIds'
  ])('rejects an added %s claim rather than treating it as authority', (key) => {
    expect(WorkflowReviewProposalSchema.safeParse({ ...proposal(), [key]: true }).success).toBe(
      false
    )
  })
  it('requires a concrete explanation instead of an empty verdict', () => {
    expect(WorkflowReviewProposalSchema.safeParse({ ...proposal(), summary: '' }).success).toBe(
      false
    )
    expect(WorkflowReviewProposalSchema.safeParse({ ...proposal(), summary: '   ' }).success).toBe(
      false
    )
  })
  it('keeps a concrete failure disposition possible when test commands are unavailable', () => {
    expect(
      WorkflowReviewProposalSchema.parse({
        ...proposal(),
        decision: 'changes_requested',
        summary: 'The code failed to build; tests could not start.'
      })
    ).toMatchObject({ decision: 'changes_requested' })
  })
  it('requires a concrete code version', () => {
    expect(
      WorkflowReviewProposalSchema.safeParse({ ...proposal(), testedCodeVersion: undefined })
        .success
    ).toBe(false)
  })
})
