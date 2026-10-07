import { createHash, randomUUID } from 'node:crypto'
import { taskCommand } from '../../src/main/tasks/task-execution.test-fixture.ts'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { WorkflowNativeOutcomeSchema } from '../../src/shared/task-workflow/workflow-native-outcome.ts'
import { WorkflowCommandEvidenceSchema } from '../../src/shared/task-workflow/workflow-command-evidence.ts'
import { WorkflowNativeDeliverySchema } from '../../src/shared/task-workflow/workflow-native-delivery.ts'

const sha = (text) => createHash('sha256').update(text).digest('hex')
const version = (text) => ({
  artifactRef: `artifact:${sha(text)}`,
  artifactRevision: 1,
  digest: sha(text)
})
const names = {
  product: 'requirements.md',
  developer: 'implementation.md',
  tester: 'test-report.md',
  ops: 'release-plan.md'
}

/** Synthetic native data exercises the actual database, inbox and Core; no Provider is executed. */
export async function workflowConsumerDelivery(h, f, admission, options = {}) {
  const task = admission.run.task,
    role = admission.run.role,
    status = options.status ?? 'succeeded'
  const command = taskCommand({
    task,
    profileId: 'codex',
    profileRevision: 'codex:1',
    runtimeRecordId: `runtime:${randomUUID()}`,
    executionId: `execution:${randomUUID()}`,
    operationId: `${Date.now()}-${randomUUID().replaceAll('-', '')}`,
    workspaceExecutionClaimRef: `claim:${randomUUID()}`,
    ownerScope: f.view.team.company.ownerScope,
    executionAccountRef: f.view.team.company.ownerAccountRef,
    workspaceRef: f.view.team.project.hiveWorkspaceRef,
    workflowContext: admission.workflowContext,
    executionDeadlineAt: admission.executionDeadlineAt,
    inputRef: `input:${admission.inputDigest}`,
    executionPolicy: {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'docker-local-linux',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: 'synthetic:consumer-pg'
    }
  })
  const commandFingerprint = computeTaskExecutionFingerprint(command, 'trusted-local:runtime')
  const binding = {
    bindingRef: `binding:${randomUUID()}`,
    paperclipCompanyId: task.spaceId,
    paperclipAgentId: admission.run.employeeRef,
    command,
    commandFingerprint
  }
  await h.repository.bind(f.accountId, task.taskId, task.runId, binding)
  const artifacts = []
  function artifact(name, text) {
    const contentDigest = sha(text)
    const item = {
      name,
      text,
      version: {
        artifactRef: `artifact:${sha(JSON.stringify([commandFingerprint, name, contentDigest]))}`,
        artifactRevision: 1,
        digest: contentDigest
      }
    }
    artifacts.push(item)
  }
  if (!options.missingReport) {
    artifact(
      names[role],
      options.reportText ?? `Synthetic accepted ${role} output for ${task.runId}`
    )
  }
  if (role === 'tester' && !options.missingProposal) {
    artifact(
      'review.json',
      JSON.stringify({
        contractVersion: 1,
        kind: 'workflow.review-proposal',
        decision: options.decision ?? 'approved',
        summary: 'Independent synthetic test result',
        testedCodeVersion: admission.workflowContext.codeInput.version
      })
    )
  }
  const identity = Object.fromEntries(
    ['protocolVersion', 'runtimeRecordId', 'ownershipEpoch', 'executionId', 'executionEpoch'].map(
      (key) => [key, command[key]]
    )
  )
  identity.commandFingerprint = commandFingerprint
  const recordedAt = new Date().toISOString(),
    sessionRef = `session:${randomUUID()}`
  const receipt = {
    ...identity,
    kind: 'execution.result',
    receiptId: `result:${randomUUID()}`,
    recordedAt,
    outcomeRef: `outcome:${randomUUID()}`,
    status,
    artifactRefs: artifacts.map((item) => item.version.artifactRef),
    usageFactRefs: [],
    stopProof: {
      proofRef: 'stop:synthetic-consumer-pg',
      evidenceKind: 'stopped',
      managedToolsSettled: true,
      writersFenced: true,
      recordedAt
    }
  }
  const producer = {
    ...identity,
    task,
    operationId: command.operationId,
    operationCallerKey: 'trusted-local:runtime',
    ownerScope: command.ownerScope,
    executionAccountRef: command.executionAccountRef,
    workspaceRef: command.workspaceRef,
    executionWorkspaceId: `folder:${randomUUID()}`,
    workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
    writeFence: command.writeFence,
    sessionRef,
    status,
    outcomeRef: receipt.outcomeRef,
    resultDigest: digest(receipt)
  }
  const output = options.testOutput ?? '# tests 1\n# pass 1\n# fail 0\n'
  const commands =
    role === 'tester' && !options.noCommands
      ? WorkflowCommandEvidenceSchema.parse({
          kind: 'available',
          producer,
          sessionId: sessionRef,
          journalCursor: { epoch: 'epoch:synthetic', sequence: 2 },
          turnItemId: 'codex:synthetic:turn:0',
          turnRevision: 1,
          turnSequence: 2,
          providerTurnId: 'turn:synthetic',
          turnOutcome: status === 'succeeded' ? 'success' : 'failure',
          commands: [
            {
              itemId: 'codex:synthetic:test:1',
              revision: 1,
              callId: 'call:synthetic',
              sequence: 1,
              command: options.testCommand ?? 'node --test',
              cwd: '/workspace',
              state: status === 'succeeded' ? 'completed' : 'failed',
              exitCode: status === 'succeeded' ? 0 : 1,
              output: {
                head: output,
                byteLength: Buffer.byteLength(output),
                digest: sha(output),
                truncated: false
              }
            }
          ]
        })
      : { kind: 'unavailable', reason: 'journal_unavailable' }
  const codeVersion =
    role === 'developer'
      ? {
          kind: 'snapshot',
          snapshot: version(`Synthetic code ${task.runId}`),
          treeDigest: sha(`Synthetic tree ${task.runId}`)
        }
      : role === 'tester'
        ? admission.workflowContext.codeInput.version
        : undefined
  const outcome = WorkflowNativeOutcomeSchema.parse({
    contractVersion: 1,
    kind: 'workflow.native-outcome',
    context: admission.workflowContext,
    producer,
    artifacts: artifacts.map(({ name, version }) => ({ name, version })),
    ...(codeVersion ? { codeVersion } : {}),
    commands:
      commands.kind === 'available'
        ? { kind: 'available', artifact: version(JSON.stringify(commands)) }
        : commands
  })
  const delivery = WorkflowNativeDeliverySchema.parse({
    kind: 'workflow.native-delivery',
    asset: { outcome, version: version(JSON.stringify(outcome)) },
    artifacts,
    commands
  })
  const accepted = {
    ...identity,
    kind: 'execution.accepted',
    receiptId: `accepted:${randomUUID()}`,
    recordedAt,
    status: 'accepted',
    operationId: command.operationId,
    workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
    writeFence: command.writeFence
  }
  const terminal = {
    ...identity,
    kind: 'execution.event',
    eventId: `event:${randomUUID()}`,
    recordedAt,
    sequence: 1,
    status,
    artifactRefs: receipt.artifactRefs
  }
  const observation = {
    ...identity,
    kind: 'execution.observation',
    accepted,
    events: [terminal],
    cursor: 1,
    lastSequence: 1,
    status,
    sessionRef,
    result: receipt
  }
  const proof = await h.repository.claimDelivery(
    f.accountId,
    task.taskId,
    task.runId,
    h.claimInput()
  )
  const token = h.token(proof)
  const consume = () =>
    h.repository.consumeObservation(
      f.accountId,
      task.taskId,
      task.runId,
      token,
      observation,
      delivery
    )
  const next = async (targetRole) => {
    const records = await f.runs.getWorkflowCaseRuns(f.accountId, {
      projectId: f.project.id,
      caseId: f.view.id
    })
    const pending = records.find((run) => run.role === targetRole && run.status === 'pending')
    if (!pending) {
      throw new Error(`No pending ${targetRole} admission`)
    }
    return f.runs.getWorkflowCaseRunAdmission(f.accountId, {
      projectId: f.project.id,
      caseId: f.view.id,
      taskId: pending.task.taskId,
      runId: pending.task.runId
    })
  }
  return { admission, task, binding, receipt, delivery, observation, token, consume, next }
}
