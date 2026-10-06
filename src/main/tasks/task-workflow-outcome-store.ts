import { createHash } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import {
  WorkflowCommandEvidenceSchema,
  type WorkflowCommandEvidence
} from '../../shared/task-workflow/workflow-command-evidence'
import {
  WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES,
  WorkflowNativeOutcomeSchema,
  WorkflowNativeOutcomeAssetSchema,
  type WorkflowNativeOutcome,
  type WorkflowNativeOutcomeAsset
} from '../../shared/task-workflow/workflow-native-outcome'
import type { TaskExecutionRecord } from './task-execution-record'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'
import type { TaskArtifactIndex } from './task-artifact-index'
import { readTaskArtifactFile } from './task-artifact-index'
import type { TaskCodeSnapshotStore } from './task-code-snapshot'
import { isTaskDockerEnforcementPolicy } from './task-docker-enforcement'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { refuseTaskExecution } from './task-execution-error'
import {
  withTaskWorkflowAssetPublication,
  writeTaskWorkflowAsset
} from './task-workflow-outcome-assets'
import {
  WorkflowNativeArtifactSchema,
  type WorkflowNativeArtifact
} from '../../shared/task-workflow/workflow-native-artifact'

const byteDigest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const versionFor = (bytes: Buffer) => {
  const hash = byteDigest(bytes)
  return { artifactRef: `artifact:${hash}`, artifactRevision: 1 as const, digest: hash }
}
const absent = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

/** Private assets describe original stopped records; access still requires the original live host grant. */
export class TaskWorkflowOutcomeStore {
  constructor(
    private readonly options: {
      directory: string
      artifacts: TaskArtifactIndex
      snapshots: TaskCodeSnapshotStore
      collectCommands: (record: TaskExecutionRecord) => Promise<WorkflowCommandEvidence>
    }
  ) {}

  async read(
    record: TaskExecutionRecord,
    assertCurrent: () => void
  ): Promise<WorkflowNativeOutcomeAsset> {
    const producer = taskCodeSnapshotProducer(record),
      context = record.command.workflowContext
    if (
      !context ||
      !producer.sessionRef ||
      !record.dockerIdentity?.containerId ||
      !isTaskDockerEnforcementPolicy(record.command.executionPolicy)
    ) {
      refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    const guard = () => assertTaskAuthorizationCurrent(assertCurrent)
    guard()
    const filename = `workflow-outcome-${digest(producer)}.json`
    return withTaskWorkflowAssetPublication(
      { directory: this.options.directory, filename, assertCurrent: guard },
      () => this.publish(record, filename, guard)
    )
  }

  private async publish(record: TaskExecutionRecord, filename: string, guard: () => void) {
    const producer = taskCodeSnapshotProducer(record),
      context = record.command.workflowContext!
    let bytes: Buffer | null = null
    try {
      bytes = await readTaskArtifactFile(this.options.directory, filename, 64 * 1024)
    } catch (error) {
      if (!absent(error)) {
        throw error
      }
    }
    guard()
    if (bytes) {
      return this.validate(record, JSON.parse(bytes.toString('utf8')), guard)
    }
    const commands = WorkflowCommandEvidenceSchema.parse(await this.options.collectCommands(record))
    guard()
    if (commands.kind === 'available' && digest(commands.producer) !== digest(producer)) {
      refuseTaskExecution('REVISION_CONFLICT')
    }
    const commandBytes =
      commands.kind === 'available' ? Buffer.from(JSON.stringify(commands)) : null
    if (commandBytes && commandBytes.byteLength > WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES) {
      refuseTaskExecution('CAPACITY_EXCEEDED')
    }
    const codeVersion =
      context.role === 'developer'
        ? (await this.options.snapshots.capture(record, guard)).version
        : context.role === 'tester'
          ? context.codeInput!.version
          : undefined
    guard()
    const artifacts: WorkflowNativeOutcome['artifacts'] = []
    for (const ref of record.result!.artifactRefs) {
      artifacts.push(await this.options.artifacts.describe(record, ref))
      guard()
    }
    let commandDescription
    if (commands.kind === 'available') {
      const data = commandBytes!
      const version = versionFor(data)
      await this.write(
        `workflow-evidence-${version.digest}.json`,
        data,
        WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES,
        guard
      )
      commandDescription = { kind: 'available' as const, artifact: version }
    } else {
      commandDescription = commands
    }
    const outcome = WorkflowNativeOutcomeSchema.parse({
      contractVersion: 1,
      kind: 'workflow.native-outcome',
      context,
      producer,
      artifacts,
      ...(codeVersion ? { codeVersion } : {}),
      commands: commandDescription
    })
    const asset = WorkflowNativeOutcomeAssetSchema.parse({
      outcome,
      version: versionFor(Buffer.from(JSON.stringify(outcome)))
    })
    await this.write(filename, Buffer.from(JSON.stringify(asset)), 64 * 1024, guard)
    return this.validate(record, asset, guard)
  }

  async readCommands(
    record: TaskExecutionRecord,
    artifactRef: string,
    assertCurrent: () => void
  ): Promise<WorkflowCommandEvidence> {
    const asset = await this.read(record, assertCurrent),
      description = asset.outcome.commands
    if (description.kind !== 'available' || description.artifact.artifactRef !== artifactRef) {
      refuseTaskExecution('FORBIDDEN')
    }
    assertTaskAuthorizationCurrent(assertCurrent)
    const bytes = await readTaskArtifactFile(
      this.options.directory,
      `workflow-evidence-${description.artifact.digest}.json`,
      WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES
    )
    assertTaskAuthorizationCurrent(assertCurrent)
    if (byteDigest(bytes) !== description.artifact.digest) {
      refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    const commands = WorkflowCommandEvidenceSchema.safeParse(JSON.parse(bytes.toString('utf8')))
    if (
      !commands.success ||
      commands.data.kind !== 'available' ||
      digest(commands.data.producer) !== digest(asset.outcome.producer) ||
      byteDigest(Buffer.from(JSON.stringify(commands.data))) !== description.artifact.digest
    ) {
      refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    return commands.data
  }

  async readArtifact(
    record: TaskExecutionRecord,
    artifactRef: string,
    assertCurrent: () => void
  ): Promise<WorkflowNativeArtifact> {
    const guard = () => assertTaskAuthorizationCurrent(assertCurrent)
    const asset = await this.read(record, guard)
    guard()
    const description = asset.outcome.artifacts.find(
      (item) => item.version.artifactRef === artifactRef
    )
    if (!description || !record.result?.artifactRefs.includes(artifactRef)) {
      refuseTaskExecution('FORBIDDEN')
    }
    const original = await this.options.artifacts.describe(record, artifactRef)
    guard()
    if (digest(original) !== digest(description)) {
      refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    const contents = await this.options.artifacts.read(record.result.outcomeRef, artifactRef)
    guard()
    if (
      contents.name !== description.name ||
      byteDigest(Buffer.from(contents.text, 'utf8')) !== description.version.digest
    ) {
      refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    const parsed = WorkflowNativeArtifactSchema.safeParse({ ...description, text: contents.text })
    if (!parsed.success) {
      refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    guard()
    return parsed.data
  }

  private async validate(record: TaskExecutionRecord, value: unknown, guard: () => void) {
    guard()
    const parsed = WorkflowNativeOutcomeAssetSchema.safeParse(value)
    if (!parsed.success) {
      refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    const asset = parsed.data,
      outcome = asset.outcome
    if (
      asset.version.artifactRef !== `artifact:${asset.version.digest}` ||
      byteDigest(Buffer.from(JSON.stringify(outcome))) !== asset.version.digest ||
      digest(outcome.producer) !== digest(taskCodeSnapshotProducer(record)) ||
      digest(outcome.context) !== digest(record.command.workflowContext!) ||
      JSON.stringify(outcome.artifacts.map((item) => item.version.artifactRef)) !==
        JSON.stringify(record.result!.artifactRefs)
    ) {
      refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    for (const artifact of outcome.artifacts) {
      const original = await this.options.artifacts.describe(record, artifact.version.artifactRef)
      guard()
      if (digest(original) !== digest(artifact)) {
        refuseTaskExecution('OUTCOME_UNKNOWN')
      }
    }
    return asset
  }

  private async write(filename: string, bytes: Buffer, maximum: number, guard: () => void) {
    await writeTaskWorkflowAsset({
      directory: this.options.directory,
      filename,
      bytes,
      maximum,
      assertCurrent: guard
    })
  }
}
