import { lstat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileTransactionLock } from '../file-transaction-lock'
import { writePluginFileAtomically } from '../plugins/plugin-atomic-file-write'
import { readTaskArtifactFile } from './task-artifact-index'
import { assertTaskDirectoryIdentity } from './task-managed-copy'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { refuseTaskExecution } from './task-execution-error'

export async function withTaskWorkflowAssetPublication<T>(
  options: {
    directory: string
    filename: string
    assertCurrent: () => void
  },
  publish: () => Promise<T>
) {
  if (
    !/^workflow-outcome-[a-f0-9]{64}\.json$/.test(options.filename) ||
    !options.filename.endsWith('.json')
  ) {
    refuseTaskExecution('INVALID_REQUEST')
  }
  assertTaskAuthorizationCurrent(options.assertCurrent)
  await mkdir(options.directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(options.directory, { bigint: true })
  const identity = {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeNs: String(stat.birthtimeNs)
  }
  assertTaskDirectoryIdentity(options.directory, identity)
  return withFileTransactionLock(
    join(options.directory, `${options.filename}.publishing`),
    async () => {
      assertTaskAuthorizationCurrent(options.assertCurrent)
      assertTaskDirectoryIdentity(options.directory, identity)
      const value = await publish()
      assertTaskAuthorizationCurrent(options.assertCurrent)
      assertTaskDirectoryIdentity(options.directory, identity)
      return value
    }
  )
}

/** Serialize asset publication and expose only complete files; existing asset bytes are immutable. */
export async function writeTaskWorkflowAsset(options: {
  directory: string
  filename: string
  bytes: Buffer
  maximum: number
  assertCurrent: () => void
}) {
  const { directory, filename, bytes, maximum } = options
  if (
    !/^workflow-(?:outcome|evidence)-[a-f0-9]{64}\.json$/.test(filename) ||
    bytes.byteLength > maximum
  ) {
    refuseTaskExecution('CAPACITY_EXCEEDED')
  }
  assertTaskAuthorizationCurrent(options.assertCurrent)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(directory, { bigint: true })
  const identity = {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeNs: String(stat.birthtimeNs)
  }
  const guard = () => {
    assertTaskAuthorizationCurrent(options.assertCurrent)
    assertTaskDirectoryIdentity(directory, identity)
  }
  guard()
  await withFileTransactionLock(join(directory, filename), async () => {
    guard()
    let existing: Buffer | null = null
    try {
      existing = await readTaskArtifactFile(directory, filename, maximum)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
    }
    guard()
    if (existing) {
      if (!existing.equals(bytes)) {
        refuseTaskExecution('OUTCOME_UNKNOWN')
      }
      return
    }
    await writePluginFileAtomically(join(directory, filename), bytes.toString('utf8'), {
      mode: 0o400
    })
    guard()
  })
  guard()
}
