import { describe, expect, it, vi } from 'vitest'
import { workflowNativeDeliveryFixture } from '../../src/shared/task-workflow/workflow-native-delivery.test-fixture.ts'
import { readWorkflowNativeDelivery } from '../../integration/paperclip/service/workflow-native-delivery.mjs'

function fixture() {
  const value = workflowNativeDeliveryFixture()
  const { outcome } = value.asset
  const client = {
    workflowOutcome: vi.fn(async () => value.asset),
    workflowArtifact: vi.fn(async () => value.artifacts[0]),
    workflowCommands: vi.fn()
  }
  const options = {
    client,
    task: {
      run_scope: {
        kind: 'workbenchCase',
        role: 'product',
        stageRef: outcome.context.stageRef,
        caseId: outcome.context.binding.workflowRunRef
      }
    },
    observation: {
      commandFingerprint: outcome.producer.commandFingerprint,
      cursor: 2,
      lastSequence: 2,
      result: {
        status: 'succeeded',
        outcomeRef: outcome.producer.outcomeRef,
        stopProof: { evidenceKind: 'stopped' }
      }
    },
    resolveBinding: vi.fn(async () => ({
      command: {
        ...outcome.producer,
        authorizationRef: 'authorization:synthetic',
        authorizationRevision: '1',
        expiresAt: '2026-10-06T10:00:00.000Z'
      },
      commandFingerprint: outcome.producer.commandFingerprint
    })),
    assertCurrent: vi.fn()
  }
  return { options, value, client }
}

describe('original native assets read under the existing delivery lease', () => {
  it('reads the exact Product plan member with a fresh binding for the second file', async () => {
    const f = fixture()
    const plan = {
      name: 'plan-proposal.json',
      text: '{',
      version: {
        artifactRef: `artifact:${'9'.repeat(64)}`,
        artifactRevision: 1,
        digest: '8'.repeat(64)
      }
    }
    f.value.artifacts.push(plan)
    f.value.asset.outcome.artifacts.push({ name: plan.name, version: plan.version })
    f.client.workflowArtifact.mockImplementation(async (query) =>
      f.value.artifacts.find((item) => item.version.artifactRef === query.artifactRef)
    )
    expect((await readWorkflowNativeDelivery(f.options)).artifacts).toEqual(f.value.artifacts)
    expect(f.options.resolveBinding).toHaveBeenCalledTimes(3)
    expect(f.client.workflowArtifact.mock.calls[1][0].artifactRef).toBe(plan.version.artifactRef)
  })
  it('stops before the plan read when its per-file binding can no longer be renewed', async () => {
    const f = fixture()
    f.value.asset.outcome.artifacts.push({
      name: 'plan-proposal.json',
      version: {
        artifactRef: `artifact:${'9'.repeat(64)}`,
        artifactRevision: 1,
        digest: '8'.repeat(64)
      }
    })
    const original = f.options.resolveBinding.getMockImplementation()
    f.options.resolveBinding
      .mockImplementationOnce(original)
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Expired original lease'))
    await expect(readWorkflowNativeDelivery(f.options)).rejects.toThrow('Expired original lease')
    expect(f.client.workflowArtifact).toHaveBeenCalledTimes(1)
  })
  it('renews original binding before each asset read and preserves its membership', async () => {
    const f = fixture()
    expect(await readWorkflowNativeDelivery(f.options)).toEqual({ ...f.value, commands: undefined })
    expect(f.options.resolveBinding).toHaveBeenCalledTimes(2)
    expect(f.client.workflowOutcome.mock.calls[0][0].kind).toBe('workflow.outcome.read')
    expect(f.client.workflowArtifact.mock.calls[0][0].artifactRef).toBe(
      f.value.artifacts[0].version.artifactRef
    )
    expect(f.client.workflowCommands).not.toHaveBeenCalled()
  })
  it('does not read assets for personal tasks', async () => {
    const f = fixture()
    f.options.task.run_scope.kind = 'personal'
    expect(await readWorkflowNativeDelivery(f.options)).toBeUndefined()
    expect(f.options.resolveBinding).not.toHaveBeenCalled()
  })
  it('does not fetch a partial terminal cursor', async () => {
    const f = fixture()
    f.options.observation.cursor = 1
    expect(await readWorkflowNativeDelivery(f.options)).toBeUndefined()
    expect(f.client.workflowOutcome).not.toHaveBeenCalled()
  })
  it('does not fetch artifacts when the native task never started', async () => {
    const f = fixture()
    f.options.observation.result.status = 'failed'
    f.options.observation.result.stopProof.evidenceKind = 'not_started'
    expect(await readWorkflowNativeDelivery(f.options)).toBeUndefined()
    expect(f.options.resolveBinding).not.toHaveBeenCalled()
  })
  it('does not produce a handoff from cancellation', async () => {
    const f = fixture()
    f.options.observation.result.status = 'cancelled'
    expect(await readWorkflowNativeDelivery(f.options)).toBeUndefined()
    expect(f.client.workflowOutcome).not.toHaveBeenCalled()
  })
  it.each(['commandFingerprint', 'outcomeRef'])(
    'rejects foreign %s before reading report text',
    async (key) => {
      const f = fixture()
      f.value.asset.outcome.producer[key] = 'foreign'
      await expect(readWorkflowNativeDelivery(f.options)).rejects.toThrow('IDEMPOTENCY_CONFLICT')
      expect(f.client.workflowArtifact).not.toHaveBeenCalled()
    }
  )
  it('retains missing report evidence as data without a success decision', async () => {
    const f = fixture()
    f.value.asset.outcome.artifacts = []
    expect((await readWorkflowNativeDelivery(f.options)).artifacts).toEqual([])
    expect(f.client.workflowArtifact).not.toHaveBeenCalled()
  })
  it('rejects ambiguous report names instead of choosing the first file', async () => {
    const f = fixture()
    f.value.asset.outcome.artifacts.push(f.value.asset.outcome.artifacts[0])
    await expect(readWorkflowNativeDelivery(f.options)).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })
  it('stops reading as soon as the real delivery lease guard is revoked', async () => {
    const f = fixture()
    f.client.workflowOutcome.mockImplementation(async () => {
      f.options.assertCurrent.mockImplementation(() => {
        throw new Error('OUTCOME_UNKNOWN')
      })
      return f.value.asset
    })
    await expect(readWorkflowNativeDelivery(f.options)).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.client.workflowArtifact).not.toHaveBeenCalled()
  })
})
