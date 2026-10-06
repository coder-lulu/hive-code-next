import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { readTaskArtifactFile, taskResultManifestName } from './task-artifact-index'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import {
  TaskCodeSnapshotManifestSchema as Snapshot,
  TaskCodeSnapshotVersionSchema as CodeVersion
} from './task-code-snapshot-manifest'
import {
  readTaskCodeTree,
  taskCodeBytesDigest,
  taskCodeTreeDigest,
  TASK_CODE_SNAPSHOT_LIMITS
} from './task-code-snapshot-tree'

export function taskCodeSnapshotFileIdentity(path: string) {
  const stat = lstatSync(path, { bigint: true })
  if (stat.isSymbolicLink()) {
    refuseTaskExecution('FORBIDDEN')
  }
  return [
    stat.dev,
    stat.ino,
    stat.birthtimeNs,
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs,
    stat.nlink
  ].join(':')
}

/** Original private source verification shared by restoration and owner inspection. */
export async function readTaskCodeSnapshotSource(
  root: string,
  versionValue: unknown,
  expected: TaskExecutionRecord,
  assertAuthorizationCurrent: () => void
) {
  assertTaskAuthorizationCurrent(assertAuthorizationCurrent)
  const parsed = CodeVersion.safeParse(versionValue)
  if (!parsed.success) {
    refuseTaskExecution('FORBIDDEN')
  }
  const version = parsed.data
  const producer = taskCodeSnapshotProducer(expected)
  if (version.snapshot.artifactRef !== `artifact:${version.snapshot.digest}`) {
    refuseTaskExecution('FORBIDDEN')
  }
  const directory = join(root, version.snapshot.digest)
  let data: Buffer
  try {
    data = await readTaskArtifactFile(
      directory,
      'manifest.json',
      TASK_CODE_SNAPSHOT_LIMITS.fileBytes
    )
  } finally {
    assertTaskAuthorizationCurrent(assertAuthorizationCurrent)
  }
  if (taskCodeBytesDigest(data) !== version.snapshot.digest) {
    refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const decoded = Snapshot.safeParse(JSON.parse(data.toString('utf8')))
  if (!decoded.success) {
    refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const manifest = decoded.data
  if (
    digest(manifest.producer) !== digest(producer) ||
    manifest.omissions.runtimeManifest !== taskResultManifestName(producer.commandFingerprint)
  ) {
    refuseTaskExecution('FORBIDDEN')
  }
  if (taskCodeTreeDigest(manifest.tree) !== version.treeDigest) {
    refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const path = join(directory, 'tree')
  const directoryIdentity = taskCodeSnapshotFileIdentity(directory)
  const manifestIdentity = taskCodeSnapshotFileIdentity(join(directory, 'manifest.json'))
  const treeIdentity = taskCodeSnapshotFileIdentity(path).split(':').slice(0, 3).join(':')
  const assertCurrent = () => {
    assertTaskAuthorizationCurrent(assertAuthorizationCurrent)
    if (
      taskCodeSnapshotFileIdentity(directory) !== directoryIdentity ||
      taskCodeSnapshotFileIdentity(join(directory, 'manifest.json')) !== manifestIdentity ||
      taskCodeSnapshotFileIdentity(path).split(':').slice(0, 3).join(':') !== treeIdentity
    ) {
      refuseTaskExecution('FORBIDDEN')
    }
  }
  assertCurrent()
  let verified: Awaited<ReturnType<typeof readTaskCodeTree>>
  try {
    verified = await readTaskCodeTree(path, assertCurrent)
  } finally {
    assertCurrent()
  }
  if (taskCodeTreeDigest(verified.tree) !== version.treeDigest) {
    refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  return {
    path,
    manifest,
    version,
    assertIdentity: assertCurrent,
    assertCurrent: verified.assertUnchanged
  }
}

export type TaskCodeSnapshotSource = Awaited<ReturnType<typeof readTaskCodeSnapshotSource>>
