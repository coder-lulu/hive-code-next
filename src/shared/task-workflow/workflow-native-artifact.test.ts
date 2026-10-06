import { describe, expect, it } from 'vitest'
import {
  WorkflowNativeArtifactSchema,
  WORKFLOW_NATIVE_ARTIFACT_MAX_BYTES
} from './workflow-native-artifact'
import { WorkflowNativeArtifactQuerySchema } from './workflow-native-outcome-query'
import { taskCommand } from '../../main/tasks/task-execution.test-fixture'

const artifact = {
  name: 'report.json',
  version: {
    artifactRef: `artifact:${'a'.repeat(64)}`,
    artifactRevision: 1,
    digest: 'b'.repeat(64)
  },
  text: ''
}
const command = taskCommand()
const query = {
  protocolVersion: 1,
  runtimeRecordId: command.runtimeRecordId,
  ownershipEpoch: command.ownershipEpoch,
  executionId: command.executionId,
  executionEpoch: command.executionEpoch,
  commandFingerprint: 'c'.repeat(64),
  authorizationRef: command.authorizationRef,
  authorizationRevision: command.authorizationRevision,
  expiresAt: command.expiresAt,
  kind: 'workflow.artifact.read',
  artifactRef: artifact.version.artifactRef
}

describe('pure native artifact wire schema', () => {
  it('accepts empty text, valid unicode and the original byte boundary', () => {
    for (const text of ['', '报告😀', '\0'.repeat(WORKFLOW_NATIVE_ARTIFACT_MAX_BYTES)]) {
      expect(WorkflowNativeArtifactSchema.parse({ ...artifact, text }).text).toBe(text)
    }
  })
  it.each([
    '\ud800',
    '\udc00',
    '界'.repeat(400_000),
    'x'.repeat(WORKFLOW_NATIVE_ARTIFACT_MAX_BYTES + 1)
  ])('rejects malformed Unicode or excessive text bytes', (text) => {
    expect(WorkflowNativeArtifactSchema.safeParse({ ...artifact, text }).success).toBe(false)
  })
  it.each([
    { ...artifact, name: '' },
    { ...artifact, name: '\ud800' },
    { ...artifact, decision: 'approved' },
    { ...artifact, version: { ...artifact.version, digest: 'short' } },
    { ...artifact, version: { ...artifact.version, artifactRevision: 2 } },
    {
      ...artifact,
      version: { ...artifact.version, artifactRef: `${artifact.version.artifactRef}\n` }
    },
    { ...artifact, version: { ...artifact.version, path: '/private' } }
  ])('rejects unbound metadata and unknown fields', (value) => {
    expect(WorkflowNativeArtifactSchema.safeParse(value).success).toBe(false)
  })
  it('accepts only the exact original identity and authority fields plus canonical ref', () => {
    expect(WorkflowNativeArtifactQuerySchema.parse(query)).toEqual(query)
    for (const extra of [{ path: '/private' }, { writersFenced: true }, { ownerProof: true }]) {
      expect(WorkflowNativeArtifactQuerySchema.safeParse({ ...query, ...extra }).success).toBe(
        false
      )
    }
    expect(
      WorkflowNativeArtifactQuerySchema.safeParse({
        ...query,
        artifactRef: `${query.artifactRef}\n`
      }).success
    ).toBe(false)
  })
})
