import { WorkflowNativeDeliverySchema } from '../../../src/shared/task-workflow/workflow-native-delivery.ts'
import { refuseTaskRepository as refuse } from './task-delivery-repository.mjs'

const reports = {
  product: 'requirements.md',
  developer: 'implementation.md',
  tester: 'test-report.md',
  ops: 'release-plan.md'
}

/** Read original immutable assets under this delivery lease; never create execution authority. */
export async function readWorkflowNativeDelivery({
  client,
  task,
  observation,
  resolveBinding,
  assertCurrent
}) {
  if (
    task.run_scope.kind !== 'workbenchCase' ||
    !observation.result ||
    observation.result.status === 'cancelled' ||
    observation.result.stopProof.evidenceKind === 'not_started' ||
    observation.cursor !== observation.lastSequence
  ) {
    return undefined
  }
  const query = async () => {
    assertCurrent()
    const binding = await resolveBinding()
    assertCurrent()
    const command = binding.command
    return {
      protocolVersion: command.protocolVersion,
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      executionId: command.executionId,
      executionEpoch: command.executionEpoch,
      commandFingerprint: binding.commandFingerprint,
      authorizationRef: command.authorizationRef,
      authorizationRevision: command.authorizationRevision,
      expiresAt: command.expiresAt
    }
  }
  const asset = await client.workflowOutcome({ ...(await query()), kind: 'workflow.outcome.read' })
  assertCurrent()
  const outcome = asset.outcome
  if (
    outcome.context.role !== task.run_scope.role ||
    outcome.context.stageRef !== task.run_scope.stageRef ||
    outcome.context.binding.workflowRunRef !== task.run_scope.caseId ||
    outcome.producer.commandFingerprint !== observation.commandFingerprint ||
    outcome.producer.status !== observation.result.status ||
    outcome.producer.outcomeRef !== observation.result.outcomeRef
  ) {
    refuse('IDEMPOTENCY_CONFLICT')
  }
  const names = [
    reports[outcome.context.role],
    ...(outcome.context.role === 'product' ? ['plan-proposal.json'] : []),
    ...(outcome.context.role === 'tester' ? ['review.json'] : [])
  ]
  const artifacts = []
  for (const name of names) {
    const matches = outcome.artifacts.filter((artifact) => artifact.name === name)
    if (matches.length > 1) {
      refuse('IDEMPOTENCY_CONFLICT')
    }
    if (matches.length === 1) {
      const artifact = await client.workflowArtifact({
        ...(await query()),
        kind: 'workflow.artifact.read',
        artifactRef: matches[0].version.artifactRef
      })
      assertCurrent()
      artifacts.push(artifact)
    }
  }
  let commands
  if (outcome.context.role === 'tester') {
    commands =
      outcome.commands.kind === 'available'
        ? await client.workflowCommands({
            ...(await query()),
            kind: 'workflow.commands.read',
            artifactRef: outcome.commands.artifact.artifactRef
          })
        : { kind: 'unavailable', reason: outcome.commands.reason }
    assertCurrent()
  }
  return WorkflowNativeDeliverySchema.parse({
    kind: 'workflow.native-delivery',
    asset,
    artifacts,
    ...(commands ? { commands } : {})
  })
}
