import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  workflowCompletionBindingRefusal,
  workflowDeploymentBindingRefusal,
  workflowHandoffBindingRefusal,
  workflowReviewBindingRefusal
} from './workflow-binding-checks'
import { workflowTestVectors as vectors } from './workflow.test-fixture'
const { team, definition, handoff, review, approval } = vectors.examples
const now = Date.parse('2026-10-03T11:00:00.000Z')

function patch(value: unknown, path: string[], replacement: unknown): unknown {
  if (!path.length) {
    return replacement
  }
  const record = z.record(z.string(), z.unknown()).parse(value)
  const [key, ...rest] = path
  return { ...record, [key]: patch(record[key], rest, replacement) }
}
function deploymentOptions(approvalValue: unknown = approval, reviewValue: unknown = review) {
  return {
    handoff,
    review: reviewValue,
    approval: approvalValue,
    targetRef: 'target:staging',
    action: 'deploy',
    actorRef: 'actor:owner',
    authorizationRevision: '1',
    now
  }
}

describe('fixed workflow/role and handoff bindings', () => {
  it('accepts an immutable definition and scoped assigned employees', () => {
    expect(workflowHandoffBindingRefusal(handoff, definition, team)).toBeNull()
    expect(workflowReviewBindingRefusal(handoff, review)).toBeNull()
    expect(workflowDeploymentBindingRefusal(deploymentOptions())).toBeNull()
  })
  it('requires the originally bound workflow version rather than latest', () => {
    expect(
      workflowHandoffBindingRefusal(handoff, { ...definition, workflowRevision: 2 }, team)
    ).toBe('workflow_binding_mismatch')
    expect(workflowHandoffBindingRefusal(handoff, definition, team)).toBeNull()
  })
  it('does not borrow tests from another stage assigned to the same tester', () => {
    expect(
      workflowReviewBindingRefusal(handoff, { ...review, stageRef: 'stage:another-test' })
    ).toBe('workflow_binding_mismatch')
  })
  it('rejects unassigned roles, audiences and missing fixed dependency versions', () => {
    expect(
      workflowHandoffBindingRefusal(
        patch(
          patch(handoff, ['consumer', 'employeeRef'], 'employee:ops'),
          ['audienceScope', 'employeeRefs'],
          ['employee:developer', 'employee:ops']
        ),
        definition,
        team
      )
    ).toBe('workflow_assignment_mismatch')
    expect(
      workflowHandoffBindingRefusal(
        patch(handoff, ['audienceScope', 'employeeRefs'], ['employee:tester', 'employee:outsider']),
        definition,
        team
      )
    ).toBe('workflow_assignment_mismatch')
    expect(
      workflowHandoffBindingRefusal({ ...handoff, dependencyVersions: [] }, definition, team)
    ).toBe('workflow_dependency_version_missing')
  })
  for (const vector of vectors.bindingCases) {
    it(vector.name, () => {
      const changed = patch(vectors.examples[vector.target], vector.path, vector.value)
      const reason =
        vector.target === 'review'
          ? workflowReviewBindingRefusal(handoff, changed)
          : workflowDeploymentBindingRefusal(deploymentOptions(changed))
      expect(reason).toBe(vector.expected)
    })
  }
  it.each(['employeeRef', 'workspaceExecutionClaimRef'])(
    'rejects independent review reusing producer %s',
    (key) => {
      const value =
        key === 'employeeRef'
          ? handoff.producer.employeeRef
          : handoff.producer.workspaceExecutionClaimRef
      expect(workflowReviewBindingRefusal(handoff, patch(review, ['reviewer', key], value))).toBe(
        'workflow_independent_test_required'
      )
    }
  )
  it('rejects reusing the producer business task or artifact as the test report', () => {
    expect(
      workflowReviewBindingRefusal(
        handoff,
        patch(review, ['reviewer', 'task', 'taskId'], handoff.producer.task.taskId)
      )
    ).toBe('workflow_independent_test_required')
    expect(workflowReviewBindingRefusal(handoff, { ...review, testReport: handoff.artifact })).toBe(
      'workflow_independent_test_required'
    )
  })
  it('binds Git patches to the precise base commit and patch digest', () => {
    const codeVersion = {
      kind: 'git_patch',
      baseCommit: 'a'.repeat(40),
      patch: handoff.artifact,
      treeDigest: 'b'.repeat(64)
    }
    const transfer = { ...handoff, codeVersion }
    const test = { ...review, codeVersion }
    expect(workflowReviewBindingRefusal(transfer, test)).toBeNull()
    expect(
      workflowReviewBindingRefusal(
        transfer,
        patch(test, ['codeVersion', 'baseCommit'], 'c'.repeat(40))
      )
    ).toBe('workflow_artifact_revision_mismatch')
    expect(
      workflowReviewBindingRefusal(
        transfer,
        patch(test, ['codeVersion', 'patch', 'digest'], 'd'.repeat(64))
      )
    ).toBe('workflow_artifact_revision_mismatch')
  })
  it.each(['changes_requested', 'rejected'])(
    'prevents deployment with test decision %s',
    (decision) => {
      expect(
        workflowDeploymentBindingRefusal(deploymentOptions(approval, { ...review, decision }))
      ).toBe('workflow_review_not_approved')
    }
  )
  it('rejects expiry at the exact deadline and malformed admission context', () => {
    expect(
      workflowDeploymentBindingRefusal({
        ...deploymentOptions(),
        now: Date.parse(approval.expiresAt)
      })
    ).toBe('workflow_deployment_authorization_mismatch')
    expect(workflowDeploymentBindingRefusal({ ...deploymentOptions(), now: Number.NaN })).toBe(
      'workflow_deployment_authorization_mismatch'
    )
    expect(
      workflowDeploymentBindingRefusal({ ...deploymentOptions(), targetRef: 'target:\n' })
    ).toBe('workflow_binding_invalid')
  })
})

describe('engineering acceptance differs from terminal rollup', () => {
  it('requires independent approval for every required code handoff', () => {
    expect(workflowCompletionBindingRefusal([handoff], [review])).toBeNull()
    expect(workflowCompletionBindingRefusal([handoff], [])).toBe('workflow_review_not_approved')
    expect(
      workflowCompletionBindingRefusal([handoff], [{ ...review, decision: 'changes_requested' }])
    ).toBe('workflow_review_not_approved')
    expect(
      workflowCompletionBindingRefusal([handoff], [{ ...review, decision: 'cancelled' }])
    ).toBe('workflow_binding_invalid')
  })
  it('does not accept empty, duplicate or conflicting review sets', () => {
    expect(workflowCompletionBindingRefusal([], [])).toBe('workflow_binding_invalid')
    expect(workflowCompletionBindingRefusal([handoff, handoff], [review])).toBe(
      'workflow_binding_invalid'
    )
    expect(workflowCompletionBindingRefusal([handoff], [review, review])).toBe(
      'workflow_review_not_approved'
    )
  })
  it('invalidates old test evidence when a new code version replaces the handoff', () => {
    const changed = patch(handoff, ['artifact', 'artifactRevision'], 2)
    expect(workflowCompletionBindingRefusal([changed], [review])).toBe(
      'workflow_artifact_revision_mismatch'
    )
  })
})
