import { describe, expect, it } from 'vitest'
import type { HiveWorkflowCaseCodePageQuery } from '../../../../../shared/hive-workflow-case-code'
import { readWorkflowCodePage, readWorkflowCodeFile } from './hive-workflow-case-code-responses'
import {
  workflowCaseCodeFixture,
  workflowCodeTextDigest
} from './hive-workflow-case-code.test-fixtures'
import { workbenchId } from './hive-workbench.test-fixtures'

describe('fixed code read response boundaries', () => {
  it.each(['projectId', 'caseId', 'handoffRef'] as const)(
    'rejects foreign %s in page and file results',
    (field) => {
      const f = workflowCaseCodeFixture()
      const query = {
        projectId: f.scope.projectId,
        caseId: f.scope.caseId,
        handoffRef: f.scope.handoffRef
      }
      expect(() =>
        readWorkflowCodePage({ ...f.page, [field]: workbenchId(998) }, query, f.handoff)
      ).toThrow('INVALID_RESPONSE')
      expect(() =>
        readWorkflowCodeFile(
          { ...f.preview, [field]: workbenchId(998) },
          { ...query, path: f.file.path },
          f.page,
          f.handoff
        )
      ).toThrow('INVALID_RESPONSE')
    }
  )
  it.each(['treeDigest', 'snapshot'] as const)('rejects a different fixed %s version', (field) => {
    const f = workflowCaseCodeFixture()
    const codeVersion =
      field === 'treeDigest'
        ? { ...f.codeVersion, treeDigest: 'a'.repeat(64) }
        : {
            ...f.codeVersion,
            snapshot: {
              artifactRef: `artifact:${'e'.repeat(64)}`,
              digest: 'e'.repeat(64),
              artifactRevision: 1
            }
          }
    expect(() => readWorkflowCodePage({ ...f.page, codeVersion }, f.scope, f.handoff)).toThrow(
      'INVALID_RESPONSE'
    )
    expect(() =>
      readWorkflowCodeFile(
        { ...f.preview, codeVersion },
        { ...f.scope, path: f.file.path },
        f.page,
        f.handoff
      )
    ).toThrow('INVALID_RESPONSE')
  })
  it.each([
    'duplicate',
    'order',
    'cursor-snapshot',
    'cursor-path',
    'after-path',
    'after-snapshot',
    'limit'
  ] as const)('rejects invalid %s page closure', (failure) => {
    const f = workflowCaseCodeFixture()
    let page = f.page
    const query: HiveWorkflowCaseCodePageQuery = {
      projectId: f.scope.projectId,
      caseId: f.scope.caseId,
      handoffRef: f.scope.handoffRef,
      after: undefined,
      limit: 50
    }
    if (failure === 'duplicate') {
      page = { ...page, files: [f.file, f.file] }
    }
    if (failure === 'order') {
      page = { ...page, files: [f.file, { ...f.file, path: 'a.ts' }] }
    }
    if (failure === 'cursor-snapshot') {
      page = { ...page, nextCursor: { snapshotRef: 'artifact:foreign', afterPath: f.file.path } }
    }
    if (failure === 'cursor-path') {
      page = {
        ...page,
        nextCursor: { snapshotRef: f.codeVersion.snapshot.artifactRef, afterPath: 'src/foreign.ts' }
      }
    }
    if (failure === 'after-path') {
      query.after = { snapshotRef: f.codeVersion.snapshot.artifactRef, afterPath: f.file.path }
    }
    if (failure === 'after-snapshot') {
      query.after = { snapshotRef: 'artifact:foreign', afterPath: 'a.ts' }
    }
    if (failure === 'limit') {
      query.limit = 1
      page = { ...page, files: [f.file, { ...f.file, path: 'z.ts' }] }
    }
    expect(() => readWorkflowCodePage(page, query, f.handoff)).toThrow('INVALID_RESPONSE')
  })
  it.each(['path', 'size', 'digest', 'executableBits'] as const)(
    'rejects substituted member %s',
    (field) => {
      const f = workflowCaseCodeFixture()
      const substitute =
        field === 'path'
          ? 'src/foreign.ts'
          : field === 'digest'
            ? 'e'.repeat(64)
            : field === 'size'
              ? f.file.size + 1
              : 0o100
      const file = { ...f.preview.file, [field]: substitute }
      expect(() =>
        readWorkflowCodeFile(
          { ...f.preview, file },
          { ...f.scope, path: f.file.path },
          f.page,
          f.handoff
        )
      ).toThrow('INVALID_RESPONSE')
    }
  )
  it('rejects a caller-selected path missing from the current verified page', () => {
    const f = workflowCaseCodeFixture()
    expect(() =>
      readWorkflowCodeFile(f.preview, { ...f.scope, path: 'src/foreign.ts' }, f.page, f.handoff)
    ).toThrow('INVALID_RESPONSE')
  })
  it('preserves empty files and BOM while detecting same-size changed text', () => {
    const f = workflowCaseCodeFixture()
    expect(
      readWorkflowCodeFile(f.preview, { ...f.scope, path: f.file.path }, f.page, f.handoff).preview
    ).toEqual({ kind: 'text', text: f.text })
    const empty = { ...f.file, size: 0, digest: workflowCodeTextDigest('') }
    expect(
      readWorkflowCodeFile(
        { ...f.preview, file: empty, preview: { kind: 'text', text: '' } },
        { ...f.scope, path: empty.path },
        { ...f.page, files: [empty] },
        f.handoff
      ).preview
    ).toEqual({ kind: 'text', text: '' })
    expect(() =>
      readWorkflowCodeFile(
        { ...f.preview, preview: { kind: 'text', text: f.text.replace('value', 'VALUE') } },
        { ...f.scope, path: f.file.path },
        f.page,
        f.handoff
      )
    ).toThrow('INVALID_RESPONSE')
  })
})
