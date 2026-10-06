import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { readNodeFileHandleWithinLimit } from '../../shared/node-bounded-file-reader'
import { taskLaunchPathKey } from './task-launch-workspace'
import { refuseTaskExecution } from './task-execution-error'
import type { TaskExecutionRecord } from './task-execution-record'
import { assertTaskOutputWorkspace } from './task-output-workspace'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const Manifest = z.strictObject({
  schemaVersion: z.literal(1),
  executionId: z.string(),
  commandFingerprint: z.string(),
  status: z.enum(['succeeded', 'failed']),
  artifacts: z.array(z.string().min(1).max(512)).max(32)
})
export const taskResultManifestName = (fingerprint: string) =>
  `.hive-task-result-${fingerprint}.json`

/** Read normal, bounded files under the execution directory, never caller-supplied absolute paths. */
export async function readTaskArtifactFile(root: string, name: string, maximum: number) {
  if (
    isAbsolute(name) ||
    name.includes('\\') ||
    name.includes(':') ||
    name.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  const base = await realpath(root)
  if ((await lstat(root)).isSymbolicLink() || taskLaunchPathKey(base) !== taskLaunchPathKey(root)) {
    return refuseTaskExecution('FORBIDDEN')
  }
  const path = resolve(base, ...name.split('/'))
  if (!taskLaunchPathKey(path).startsWith(`${taskLaunchPathKey(base)}${sep}`)) {
    return refuseTaskExecution('FORBIDDEN')
  }
  let current = base
  for (const part of name.split('/')) {
    current = join(current, part)
    if (
      (await lstat(current)).isSymbolicLink() ||
      taskLaunchPathKey(await realpath(current)) !== taskLaunchPathKey(current)
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
  }
  const before = await lstat(path)
  if (!before.isFile() || before.nlink !== 1) {
    return refuseTaskExecution('FORBIDDEN')
  }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const data = await readNodeFileHandleWithinLimit(file, maximum)
    const after = await lstat(path)
    if (
      data.stats.ino !== before.ino ||
      after.ino !== before.ino ||
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size ||
      after.isSymbolicLink() ||
      data.buffer.byteLength !== before.size ||
      taskLaunchPathKey(await realpath(root)) !== taskLaunchPathKey(root) ||
      taskLaunchPathKey(await realpath(path)) !== taskLaunchPathKey(path)
    ) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    return data.buffer
  } finally {
    await file.close()
  }
}

/** Artifact references name immutable host-owned snapshots, not writable workspace paths. */
export class TaskArtifactIndex {
  constructor(private readonly directory: string) {}

  async collect(record: TaskExecutionRecord, turnOutcome: 'success' | 'failure') {
    const tester = record.command.workflowContext?.role === 'tester'
    const assertSource = () => {
      if (tester) {
        assertTaskOutputWorkspace(record.workspace)
      }
    }
    assertSource()
    const source = tester
      ? (record.workspace.outputDirectory?.path ?? refuseTaskExecution('OUTCOME_UNKNOWN'))
      : record.workspace.executionPath
    let contents: Buffer
    try {
      contents = await readTaskArtifactFile(
        source,
        taskResultManifestName(record.commandFingerprint),
        16 * 1024
      )
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        if (turnOutcome === 'success') {
          return null
        }
        contents = Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            executionId: record.command.executionId,
            commandFingerprint: record.commandFingerprint,
            status: 'failed',
            artifacts: []
          })
        )
      } else {
        throw error
      }
    }
    const manifest = Manifest.parse(JSON.parse(contents.toString('utf8')))
    assertSource()
    if (
      manifest.executionId !== record.command.executionId ||
      manifest.commandFingerprint !== record.commandFingerprint
    ) {
      return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
    }
    const status = turnOutcome === 'failure' ? 'failed' : manifest.status
    const artifacts: { ref: string; name: string; digest: string }[] = []
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    for (const name of new Set(manifest.artifacts)) {
      assertSource()
      const data = await readTaskArtifactFile(source, name, 8 * 1024 * 1024)
      assertSource()
      const digest = hash(data)
      const id = hash(JSON.stringify([record.commandFingerprint, name, digest]))
      const destination = join(this.directory, id)
      try {
        await writeFile(destination, data, { flag: 'wx', mode: 0o600 })
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
          throw error
        }
        if (hash(await readTaskArtifactFile(this.directory, id, 8 * 1024 * 1024)) !== digest) {
          return refuseTaskExecution('OUTCOME_UNKNOWN')
        }
      }
      artifacts.push({ ref: `artifact:${id}`, name, digest })
    }
    const outcomeId = hash(JSON.stringify([record.commandFingerprint, status, artifacts]))
    await writeFile(
      join(this.directory, `outcome-${outcomeId}.json`),
      JSON.stringify({ status, artifacts }),
      { mode: 0o600 }
    )
    return {
      outcomeRef: `outcome:${outcomeId}`,
      artifactRefs: artifacts.map((entry) => entry.ref),
      status
    }
  }

  async read(outcomeRef: string, artifactRef: string) {
    if (
      !/^outcome:[a-f0-9]{64}$/.test(outcomeRef) ||
      !/^artifact:[a-f0-9]{64}$/.test(artifactRef)
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const data = await readTaskArtifactFile(
      this.directory,
      `outcome-${outcomeRef.slice(8)}.json`,
      32 * 1024
    )
    const outcome = z
      .object({
        artifacts: z
          .array(z.object({ ref: z.string(), name: z.string(), digest: z.string() }))
          .max(32)
      })
      .parse(JSON.parse(data.toString('utf8')))
    const entry = outcome.artifacts.find((artifact) => artifact.ref === artifactRef)
    if (!entry) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const contents = await readTaskArtifactFile(
      this.directory,
      artifactRef.slice(9),
      8 * 1024 * 1024
    )
    if (hash(contents) !== entry.digest) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    if (contents.byteLength > 1024 * 1024) {
      return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    return { name: entry.name, text: new TextDecoder('utf-8', { fatal: true }).decode(contents) }
  }
}
