import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { workflowNativeDeliveryFixture } from '../../src/shared/task-workflow/workflow-native-delivery.test-fixture.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { validateWorkflowNativeOutcome } from '../../integration/paperclip/service/workflow-native-outcome-policy.mjs'

const sha = (text) => createHash('sha256').update(text).digest('hex')
const version = (text) => ({
  artifactRef: `artifact:${sha(text)}`,
  artifactRevision: 1,
  digest: sha(text)
})
function fixture() {
  const delivery = workflowNativeDeliveryFixture(),
    outcome = delivery.asset.outcome
  outcome.producer.operationCallerKey = 'trusted-local:runtime'
  const report = delivery.artifacts[0]
  report.version = {
    ...version(report.text),
    artifactRef: `artifact:${sha(
      JSON.stringify([outcome.producer.commandFingerprint, report.name, sha(report.text)])
    )}`
  }
  outcome.artifacts = [{ name: report.name, version: report.version }]
  const receipt = {
    protocolVersion: outcome.producer.protocolVersion,
    runtimeRecordId: outcome.producer.runtimeRecordId,
    ownershipEpoch: outcome.producer.ownershipEpoch,
    executionId: outcome.producer.executionId,
    executionEpoch: outcome.producer.executionEpoch,
    commandFingerprint: outcome.producer.commandFingerprint,
    kind: 'execution.result',
    receiptId: 'receipt:synthetic',
    recordedAt: '2026-10-06T10:00:00.000Z',
    outcomeRef: outcome.producer.outcomeRef,
    status: 'succeeded',
    artifactRefs: [report.version.artifactRef],
    usageFactRefs: [],
    stopProof: {
      proofRef: 'stop:synthetic',
      evidenceKind: 'stopped',
      managedToolsSettled: true,
      writersFenced: true,
      recordedAt: '2026-10-06T10:00:00.000Z'
    }
  }
  outcome.producer.resultDigest = digest(receipt)
  const task = {
    binding: {
      command: {
        ...structuredClone(outcome.producer),
        workflowContext: structuredClone(outcome.context)
      },
      commandFingerprint: outcome.producer.commandFingerprint
    }
  }
  const seal = () => {
    delivery.asset.version = version(JSON.stringify(outcome))
  }
  seal()
  return { delivery, receipt, task, outcome, report, seal }
}

describe('private native data hashes match the original bound task and result', () => {
  it('accepts the original uniquely named nested report with unchanged provenance checks', () => {
    const f = fixture()
    f.report.name = 'deliverables/product-v1/requirements.md'
    f.report.version.artifactRef = `artifact:${sha(JSON.stringify([f.outcome.producer.commandFingerprint, f.report.name, sha(f.report.text)]))}`
    f.outcome.artifacts[0].name = f.report.name
    f.receipt.artifactRefs = [f.report.version.artifactRef]
    f.outcome.producer.resultDigest = digest(f.receipt)
    f.seal()
    expect(validateWorkflowNativeOutcome(f.task, f.receipt, f.delivery).report).toEqual(f.report)
  })
  it('rejects a supplied subset that hides a second manifest report', () => {
    const f = fixture()
    const member = { name: 'v2/requirements.md', version: version('other report') }
    f.outcome.artifacts.push(member)
    f.receipt.artifactRefs.push(member.version.artifactRef)
    f.outcome.producer.resultDigest = digest(f.receipt)
    f.seal()
    expect(() => validateWorkflowNativeOutcome(f.task, f.receipt, f.delivery)).toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
  })
  it('preserves a failed outcome without a report as missing evidence', () => {
    const f = fixture()
    f.outcome.artifacts = []
    f.delivery.artifacts = []
    f.receipt.artifactRefs = []
    f.receipt.status = f.outcome.producer.status = 'failed'
    f.outcome.producer.resultDigest = digest(f.receipt)
    f.seal()
    expect(validateWorkflowNativeOutcome(f.task, f.receipt, f.delivery).report).toBeUndefined()
  })
  it('accepts complete synthetic content without creating execution or approval authority', () => {
    const f = fixture()
    expect(validateWorkflowNativeOutcome(f.task, f.receipt, f.delivery).report).toEqual(f.report)
  })
  it.each([
    'runtimeRecordId',
    'ownershipEpoch',
    'executionId',
    'executionEpoch',
    'operationId',
    'executionAccountRef',
    'workspaceRef',
    'workspaceExecutionClaimRef',
    'writeFence'
  ])('rejects a resealed foreign %s', (key) => {
    const f = fixture()
    f.outcome.producer[key] =
      typeof f.outcome.producer[key] === 'number'
        ? f.outcome.producer[key] + 1
        : `${f.outcome.producer[key]}:foreign`
    if (key === 'operationId') {
      f.outcome.producer[key] = '1791277298001-0123456789abcdef0123456789abcdef'
    }
    f.seal()
    expect(() => validateWorkflowNativeOutcome(f.task, f.receipt, f.delivery)).toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
  })
  it.each(['commandFingerprint', 'operationCallerKey', 'outcomeRef', 'resultDigest'])(
    'rejects a resealed mismatched %s',
    (key) => {
      const f = fixture()
      f.outcome.producer[key] =
        key === 'commandFingerprint' || key === 'resultDigest' ? '0'.repeat(64) : 'ref:foreign'
      f.seal()
      expect(() => validateWorkflowNativeOutcome(f.task, f.receipt, f.delivery)).toThrow(
        'IDEMPOTENCY_CONFLICT'
      )
    }
  )
  it('rejects a forged report body even when the original manifest is unchanged', () => {
    const f = fixture()
    f.report.text += ' modified'
    expect(() => validateWorkflowNativeOutcome(f.task, f.receipt, f.delivery)).toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
  })
  it('rejects a foreign frozen context even when the model reseals the outcome', () => {
    const f = fixture()
    f.outcome.context.stageRef = 'stage:foreign'
    f.seal()
    expect(() => validateWorkflowNativeOutcome(f.task, f.receipt, f.delivery)).toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
  })
  it('rejects a result whose member list diverges from the original manifest', () => {
    const f = fixture()
    f.receipt.artifactRefs = []
    f.outcome.producer.resultDigest = digest(f.receipt)
    f.seal()
    expect(() => validateWorkflowNativeOutcome(f.task, f.receipt, f.delivery)).toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
  })
  it('rejects a changed original stop proof instead of ignoring result provenance', () => {
    const f = fixture()
    f.receipt.stopProof.proofRef = 'stop:foreign'
    expect(() => validateWorkflowNativeOutcome(f.task, f.receipt, f.delivery)).toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
  })
})
