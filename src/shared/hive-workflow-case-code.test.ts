import { describe, expect, it } from 'vitest'
import {
  HiveWorkflowCaseCodePageQuerySchema,
  HiveWorkflowCaseCodeFileQuerySchema,
  HiveWorkflowCaseCodePageSchema,
  HiveWorkflowCaseCodeFileSchema,
  HIVE_WORKFLOW_CODE_INSPECTION_LIMITS
} from './hive-workflow-case-code'
import { TaskCodeSnapshotTreeSchema } from './task-workflow/workflow-code-snapshot-tree'

const scope = {
  projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  caseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  handoffRef: 'handoff:original'
}
const codeVersion = {
  kind: 'snapshot',
  snapshot: {
    artifactRef: `artifact:${'c'.repeat(64)}`,
    artifactRevision: 1,
    digest: 'c'.repeat(64)
  },
  treeDigest: 'd'.repeat(64)
}
const file = { path: 'src/app.ts', size: 3, digest: 'e'.repeat(64), executableBits: 0 }
describe('bounded owner code inspection data', () => {
  it('accepts a fixed version page with its exact original cursor', () => {
    const page = {
      ...scope,
      codeVersion,
      files: [file],
      nextCursor: { snapshotRef: codeVersion.snapshot.artifactRef, afterPath: file.path }
    }
    expect(HiveWorkflowCaseCodePageSchema.parse(page)).toEqual(page)
    expect(HiveWorkflowCaseCodePageQuerySchema.parse(scope).limit).toBe(50)
  })
  it.each([
    '../app.ts',
    '/app.ts',
    'C:/app.ts',
    'src\\app.ts',
    'src//app.ts',
    'src/./app.ts',
    'src/../app.ts',
    'src/app.ts\0'
  ])('refuses a nonmember path spelling %s', (path) => {
    expect(HiveWorkflowCaseCodeFileQuerySchema.safeParse({ ...scope, path }).success).toBe(false)
  })
  it('rejects caller-provided authority, producer, offsets and absolute storage roots', () => {
    for (const field of ['authorized', 'producer', 'offset', 'executionPath']) {
      expect(
        HiveWorkflowCaseCodeFileQuerySchema.safeParse({
          ...scope,
          path: file.path,
          [field]: 'foreign'
        }).success
      ).toBe(false)
    }
  })
  it('rejects duplicate, unordered or foreign-version page cursors', () => {
    const page = { ...scope, codeVersion, files: [file], nextCursor: null }
    expect(HiveWorkflowCaseCodePageSchema.safeParse({ ...page, files: [file, file] }).success).toBe(
      false
    )
    expect(
      HiveWorkflowCaseCodePageSchema.safeParse({
        ...page,
        files: [{ ...file, path: 'z.ts' }, file]
      }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseCodePageSchema.safeParse({
        ...page,
        nextCursor: { snapshotRef: `artifact:${'f'.repeat(64)}`, afterPath: file.path }
      }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseCodePageSchema.safeParse({
        ...page,
        nextCursor: { snapshotRef: codeVersion.snapshot.artifactRef, afterPath: 'foreign.ts' }
      }).success
    ).toBe(false)
  })
  it('bounds both file count and serialized Unicode metadata', () => {
    const files = Array.from({ length: 51 }, (_, index) => ({
      ...file,
      path: `file-${String(index).padStart(2, '0')}.ts`
    }))
    expect(
      HiveWorkflowCaseCodePageSchema.safeParse({ ...scope, codeVersion, files, nextCursor: null })
        .success
    ).toBe(false)
    const long = Array.from({ length: 50 }, (_, index) => ({
      ...file,
      path: `${String(index).padStart(2, '0')}-${'界'.repeat(4000)}`
    }))
    expect(
      HiveWorkflowCaseCodePageSchema.safeParse({
        ...scope,
        codeVersion,
        files: long,
        nextCursor: null
      }).success
    ).toBe(false)
  })
  it('requires the exact snapshot digest and original revision', () => {
    const page = { ...scope, codeVersion, files: [], nextCursor: null }
    expect(
      HiveWorkflowCaseCodePageSchema.safeParse({
        ...page,
        codeVersion: {
          ...codeVersion,
          snapshot: { ...codeVersion.snapshot, artifactRef: 'artifact:foreign' }
        }
      }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseCodePageSchema.safeParse({
        ...page,
        codeVersion: { ...codeVersion, snapshot: { ...codeVersion.snapshot, artifactRevision: 2 } }
      }).success
    ).toBe(false)
  })
  it('preserves exact UTF-8 size, zero bytes and BOM in readonly text', () => {
    for (const text of ['', '界', '\uFEFFtext']) {
      const size = new TextEncoder().encode(text).byteLength
      expect(
        HiveWorkflowCaseCodeFileSchema.parse({
          ...scope,
          codeVersion,
          file: { ...file, size },
          preview: { kind: 'text', text }
        }).preview
      ).toEqual({ kind: 'text', text })
    }
    expect(
      HiveWorkflowCaseCodeFileSchema.safeParse({
        ...scope,
        codeVersion,
        file,
        preview: { kind: 'text', text: '界界' }
      }).success
    ).toBe(false)
  })
  it('distinguishes binary and oversized preview from a verified text result', () => {
    const value = {
      ...scope,
      codeVersion,
      file,
      preview: { kind: 'unavailable', reason: 'binary' }
    }
    expect(HiveWorkflowCaseCodeFileSchema.safeParse(value).success).toBe(true)
    expect(
      HiveWorkflowCaseCodeFileSchema.safeParse({
        ...value,
        preview: { kind: 'unavailable', reason: 'too_large' }
      }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseCodeFileSchema.safeParse({
        ...value,
        file: { ...file, size: HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.previewBytes + 1 },
        preview: { kind: 'unavailable', reason: 'too_large' }
      }).success
    ).toBe(true)
  })
  it('preserves the original complete-tree hierarchy and byte bound', () => {
    expect(
      TaskCodeSnapshotTreeSchema.safeParse({ directories: ['src'], files: [file] }).success
    ).toBe(true)
    expect(TaskCodeSnapshotTreeSchema.safeParse({ directories: [], files: [file] }).success).toBe(
      false
    )
    expect(
      TaskCodeSnapshotTreeSchema.safeParse({ directories: ['src'], files: [file, file] }).success
    ).toBe(false)
  })
})
