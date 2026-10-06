import { chmodSync, lstatSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { taskResultManifestName } from './task-artifact-index'
import { createTaskManagedCopy, assertTaskDirectoryIdentity } from './task-managed-copy'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'
import { taskLaunchPathKey } from './task-launch-workspace'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import {
  TaskCodeSnapshotManifestSchema as Snapshot,
  type TaskCodeSnapshotVersion
} from './task-code-snapshot-manifest'
import {
  readTaskCodeTree,
  taskCodeBytesDigest,
  taskCodeTreeDigest,
  TASK_CODE_SNAPSHOT_LIMITS
} from './task-code-snapshot-tree'
import {
  readTaskCodeSnapshotSource,
  taskCodeSnapshotFileIdentity as fileIdentity
} from './task-code-snapshot-source'
import {
  inspectTaskCodeSnapshotPage,
  inspectTaskCodeSnapshotFile
} from './task-code-snapshot-inspection'
import type {
  HiveWorkflowCaseCodePageQuery,
  HiveWorkflowCaseCodePage,
  HiveWorkflowCaseCodeFileQuery,
  HiveWorkflowCaseCodeFile
} from '../../shared/hive-workflow-case-code'

export type { TaskCodeSnapshotVersion } from './task-code-snapshot-manifest'
const inside = (root: string, path: string) => {
  const suffix = relative(root, path)
  return suffix !== '' && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`)
}

/** Internal asset port; expected producer records come from the original host store, after current account/Case authorization. */
export class TaskCodeSnapshotStore {
  private readonly directory: string
  constructor(artifactsDirectory: string) {
    this.directory = resolve(artifactsDirectory, 'code-snapshots')
  }

  async capture(
    record: TaskExecutionRecord,
    assertAuthorizationCurrent: () => void = () => undefined
  ) {
    const producer = taskCodeSnapshotProducer(record)
    const source = record.workspace.executionPath
    const commandDigest = digest(record.command),
      sourceIdentity = structuredClone(record.workspace.directoryIdentity)
    if (this.directory === resolve(source) || inside(resolve(source), this.directory)) {
      refuseTaskExecution('FORBIDDEN')
    }
    const assertProducer = () => {
      assertTaskAuthorizationCurrent(assertAuthorizationCurrent)
      if (
        record.status !== producer.status ||
        record.dispatch !== 'bound' ||
        record.cancellationKey !== null ||
        digest(record.command) !== commandDigest ||
        digest(record.result ?? {}) !== producer.resultDigest
      ) {
        refuseTaskExecution('REVISION_CONFLICT')
      }
      assertTaskDirectoryIdentity(source, sourceIdentity)
    }
    assertProducer()
    const omissions = {
      directories: ['.git', 'node_modules', 'logs'],
      runtimeManifest: taskResultManifestName(record.commandFingerprint)
    }
    const original = await readTaskCodeTree(source, assertProducer, omissions)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    if (
      lstatSync(this.directory).isSymbolicLink() ||
      taskLaunchPathKey(await realpath(this.directory)) !== taskLaunchPathKey(this.directory)
    ) {
      refuseTaskExecution('FORBIDDEN')
    }
    const staging = await mkdtemp(join(this.directory, 'pending-'))
    const identity = fileIdentity(staging)
    let published = false
    try {
      const copy = await createTaskManagedCopy({
        source,
        directory: staging,
        assertCurrent: assertProducer
      })
      const runtimeManifest = join(copy.executionPath, omissions.runtimeManifest)
      await rm(runtimeManifest, { force: true })
      const copied = await readTaskCodeTree(copy.executionPath, copy.assertCurrent)
      original.assertUnchanged()
      if (taskCodeTreeDigest(copied.tree) !== taskCodeTreeDigest(original.tree)) {
        refuseTaskExecution('REVISION_CONFLICT')
      }
      const manifest = Snapshot.parse({ schemaVersion: 1, producer, omissions, tree: copied.tree })
      const bytes = Buffer.from(JSON.stringify(manifest))
      if (bytes.byteLength > TASK_CODE_SNAPSHOT_LIMITS.fileBytes) {
        refuseTaskExecution('CAPACITY_EXCEEDED')
      }
      const hash = taskCodeBytesDigest(bytes)
      const version: TaskCodeSnapshotVersion = {
        kind: 'snapshot',
        snapshot: { artifactRef: `artifact:${hash}`, artifactRevision: 1, digest: hash },
        treeDigest: taskCodeTreeDigest(manifest.tree)
      }
      copied.assertUnchanged()
      for (const file of manifest.tree.files) {
        await chmod(join(copy.executionPath, ...file.path.split('/')), 0o400 | file.executableBits)
      }
      await rename(copy.executionPath, join(staging, 'tree'))
      await writeFile(join(staging, 'manifest.json'), bytes, { flag: 'wx', mode: 0o400 })
      assertProducer()
      const destination = join(this.directory, hash)
      try {
        await rename(staging, destination)
        published = true
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            ['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(String(error.code))
          )
        ) {
          throw error
        }
      }
      const stored = await this.readSource(version, record, assertAuthorizationCurrent)
      stored.assertCurrent()
      return {
        version,
        producer: manifest.producer,
        omissions: manifest.omissions,
        files: manifest.tree.files,
        directories: manifest.tree.directories
      }
    } finally {
      if (
        !published &&
        inside(this.directory, staging) &&
        lstatSync(this.directory).isDirectory()
      ) {
        try {
          const current = lstatSync(staging, { bigint: true })
          if (
            !current.isSymbolicLink() &&
            identity.split(':').slice(0, 3).join(':') ===
              [current.dev, current.ino, current.birthtimeNs].join(':')
          ) {
            await rm(staging, { recursive: true, force: true })
          }
        } catch {
          /* A replaced directory is not an owned cleanup target. */
        }
      }
    }
  }

  private source(
    versionValue: unknown,
    expected: TaskExecutionRecord,
    assertAuthorizationCurrent: () => void
  ) {
    return readTaskCodeSnapshotSource(
      this.directory,
      versionValue,
      expected,
      assertAuthorizationCurrent
    )
  }

  getCodePage(
    version: unknown,
    expected: TaskExecutionRecord,
    query: HiveWorkflowCaseCodePageQuery,
    guard: () => void
  ): Promise<HiveWorkflowCaseCodePage> {
    return inspectTaskCodeSnapshotPage(() => this.source(version, expected, guard), query, guard)
  }

  getCodeFile(
    version: unknown,
    expected: TaskExecutionRecord,
    query: HiveWorkflowCaseCodeFileQuery,
    guard: () => void
  ): Promise<HiveWorkflowCaseCodeFile> {
    return inspectTaskCodeSnapshotFile(() => this.source(version, expected, guard), query, guard)
  }

  async readSource(
    version: unknown,
    expectedProducer: TaskExecutionRecord,
    assertAuthorizationCurrent: () => void = () => undefined
  ) {
    const source = await this.source(version, expectedProducer, assertAuthorizationCurrent)
    return {
      path: source.path,
      assertCurrent: source.assertCurrent,
      treeDigest: source.version.treeDigest
    }
  }

  async restore(
    version: unknown,
    expectedProducer: TaskExecutionRecord,
    directory: string,
    assertAuthorizationCurrent: () => void = () => undefined
  ) {
    const source = await this.source(version, expectedProducer, assertAuthorizationCurrent)
    const copy = await createTaskManagedCopy({
      source: source.path,
      directory,
      assertCurrent: source.assertIdentity
    })
    try {
      const restored = await readTaskCodeTree(copy.executionPath, copy.assertCurrent)
      source.assertCurrent()
      if (taskCodeTreeDigest(restored.tree) !== source.version.treeDigest) {
        refuseTaskExecution('OUTCOME_UNKNOWN')
      }
      for (const file of source.manifest.tree.files) {
        chmodSync(join(copy.executionPath, ...file.path.split('/')), 0o600 | file.executableBits)
      }
      const current = await readTaskCodeTree(copy.executionPath, copy.assertCurrent)
      if (taskCodeTreeDigest(current.tree) !== source.version.treeDigest) {
        refuseTaskExecution('OUTCOME_UNKNOWN')
      }
      return {
        ...copy,
        treeDigest: source.version.treeDigest,
        assertCurrent: current.assertUnchanged,
        assertDirectoryCurrent: copy.assertCurrent
      }
    } catch (error) {
      try {
        assertTaskDirectoryIdentity(copy.executionPath, copy.directoryIdentity)
        if (inside(resolve(directory), copy.executionPath)) {
          await rm(copy.executionPath, { recursive: true, force: true })
        }
      } catch {
        /* Do not delete an unowned replacement. */
      }
      throw error
    }
  }
}
