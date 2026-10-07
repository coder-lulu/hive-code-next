import { workflowTestVectors } from './workflow.test-fixture'
// Synthetic metadata only: parsing this data grants no execution or review authority.
export function workflowNativeDeliveryFixture() {
  const handoff = workflowTestVectors.examples.handoff
  const version = {
    artifactRef: `artifact:${'a'.repeat(64)}`,
    artifactRevision: 1,
    digest: 'b'.repeat(64)
  }
  return {
    kind: 'workflow.native-delivery',
    asset: {
      version: { ...version, artifactRef: `artifact:${'c'.repeat(64)}` },
      outcome: {
        contractVersion: 1,
        kind: 'workflow.native-outcome',
        context: {
          kind: 'workflow.execution-context',
          binding: handoff.binding,
          definitionDigest: 'd'.repeat(64),
          stageRef: 'stage:product',
          employeeRef: 'employee:product',
          role: 'product',
          handoffRefs: []
        },
        producer: {
          protocolVersion: 1,
          runtimeRecordId: 'runtime:synthetic',
          ownershipEpoch: 1,
          executionId: 'execution:synthetic',
          executionEpoch: 1,
          task: handoff.producer.task,
          commandFingerprint: 'e'.repeat(64),
          operationId: '1791277298000-0123456789abcdef0123456789abcdef',
          operationCallerKey: 'caller:synthetic',
          ownerScope: { kind: 'personalTenant', tenantRef: 'tenant:synthetic' },
          executionAccountRef: 'account:synthetic',
          workspaceRef: 'workspace:synthetic',
          executionWorkspaceId: 'folder:synthetic',
          workspaceExecutionClaimRef: 'claim:synthetic',
          writeFence: 1,
          sessionRef: 'session:synthetic',
          status: 'succeeded',
          outcomeRef: 'outcome:synthetic',
          resultDigest: 'f'.repeat(64)
        },
        artifacts: [{ name: 'requirements.md', version }],
        commands: { kind: 'unavailable', reason: 'journal_unavailable' }
      }
    },
    artifacts: [{ name: 'requirements.md', version, text: 'Synthetic requirements' }],
    commands: { kind: 'unavailable', reason: 'journal_unavailable' }
  }
}
