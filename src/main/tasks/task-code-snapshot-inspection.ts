import {
  HiveWorkflowCaseCodeFileQuerySchema,
  HiveWorkflowCaseCodeFileSchema,
  HiveWorkflowCaseCodePageQuerySchema,
  HiveWorkflowCaseCodePageSchema,
  HIVE_WORKFLOW_CODE_INSPECTION_LIMITS,
  type HiveWorkflowCaseCodeFileQuery,
  type HiveWorkflowCaseCodeFile,
  type HiveWorkflowCaseCodePageQuery,
  type HiveWorkflowCaseCodePage
} from '../../shared/hive-workflow-case-code'
import { readTaskArtifactFile } from './task-artifact-index'
import { taskCodeBytesDigest } from './task-code-snapshot-tree'
import type { TaskCodeSnapshotSource } from './task-code-snapshot-source'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'

type ReadSource = () => Promise<TaskCodeSnapshotSource>
async function readCurrentSource(readSource: ReadSource, guard: () => void) {
  assertTaskAuthorizationCurrent(guard)
  try {
    return await readSource()
  } finally {
    assertTaskAuthorizationCurrent(guard)
  }
}
function assertSource(source: TaskCodeSnapshotSource, guard: () => void) {
  assertTaskAuthorizationCurrent(guard)
  source.assertCurrent()
}

export async function inspectTaskCodeSnapshotPage(
  readSource: ReadSource,
  query: HiveWorkflowCaseCodePageQuery,
  guard: () => void
): Promise<HiveWorkflowCaseCodePage> {
  assertTaskAuthorizationCurrent(guard)
  const parsed = HiveWorkflowCaseCodePageQuerySchema.safeParse(query)
  if (!parsed.success) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  const source = await readCurrentSource(readSource, guard)
  assertSource(source, guard)
  const { limit, after, ...scope } = parsed.data
  const files = source.manifest.tree.files
  const cursor = after ? files.findIndex((file) => file.path === after.afterPath) : -1
  if (after && (after.snapshotRef !== source.version.snapshot.artifactRef || cursor < 0)) {
    return refuseTaskExecution('FORBIDDEN')
  }
  const start = cursor + 1
  let page: HiveWorkflowCaseCodePage = {
    ...scope,
    codeVersion: source.version,
    files: [],
    nextCursor: null
  }
  for (let index = start; index < Math.min(files.length, start + limit); index++) {
    const selected = [...page.files, files[index]]
    const candidate: HiveWorkflowCaseCodePage = {
      ...scope,
      codeVersion: source.version,
      files: selected,
      nextCursor:
        index + 1 < files.length
          ? { snapshotRef: source.version.snapshot.artifactRef, afterPath: files[index].path }
          : null
    }
    if (
      Buffer.byteLength(JSON.stringify(candidate)) > HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.pageBytes
    ) {
      break
    }
    page = candidate
  }
  if (start < files.length && page.files.length === 0) {
    return refuseTaskExecution('CAPACITY_EXCEEDED')
  }
  assertSource(source, guard)
  return HiveWorkflowCaseCodePageSchema.parse(page)
}

function textPreview(bytes: Buffer): HiveWorkflowCaseCodeFile['preview'] {
  if (!bytes.includes(0)) {
    try {
      return {
        kind: 'text',
        text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      }
    } catch {
      /* Invalid UTF-8 is binary presentation data, never replacement-decoded text. */
    }
  }
  return { kind: 'unavailable', reason: 'binary' }
}

export async function inspectTaskCodeSnapshotFile(
  readSource: ReadSource,
  query: HiveWorkflowCaseCodeFileQuery,
  guard: () => void
): Promise<HiveWorkflowCaseCodeFile> {
  assertTaskAuthorizationCurrent(guard)
  const parsed = HiveWorkflowCaseCodeFileQuerySchema.safeParse(query)
  if (!parsed.success) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  const source = await readCurrentSource(readSource, guard)
  assertSource(source, guard)
  const { path, ...scope } = parsed.data
  const file = source.manifest.tree.files.find((member) => member.path === path)
  if (!file) {
    return refuseTaskExecution('FORBIDDEN')
  }
  let preview: HiveWorkflowCaseCodeFile['preview'] = { kind: 'unavailable', reason: 'too_large' }
  if (file.size <= HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.previewBytes) {
    assertSource(source, guard)
    let bytes: Buffer
    try {
      bytes = await readTaskArtifactFile(
        source.path,
        file.path,
        HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.previewBytes
      )
    } finally {
      assertSource(source, guard)
    }
    if (bytes.byteLength !== file.size || taskCodeBytesDigest(bytes) !== file.digest) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    preview = textPreview(bytes)
  }
  assertSource(source, guard)
  return HiveWorkflowCaseCodeFileSchema.parse({
    ...scope,
    codeVersion: source.version,
    file,
    preview
  })
}
