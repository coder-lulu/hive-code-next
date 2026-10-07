import { chmod, link, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HIVE_WORKFLOW_CODE_INSPECTION_LIMITS } from '../../shared/hive-workflow-case-code'
import { snapshotInspectionFixture } from './task-code-snapshot-inspection.test-fixture'
import * as trees from './task-code-snapshot-tree'
import * as artifacts from './task-artifact-index'

describe('owner fixed snapshot read-only inspection with synthetic producer evidence', () => {
  it('enumerates ordinal pages bound to the exact fixed version without recapture, restore, or native paths', async () => {
    const f = await snapshotInspectionFixture()
    await mkdir(join(f.record.workspace.executionPath, 'files'))
    await Promise.all(
      Array.from({ length: 107 }, (_, index) =>
        writeFile(
          join(f.record.workspace.executionPath, 'files', `${String(index).padStart(3, '0')}.ts`),
          'fixed\n'
        )
      )
    )
    const snapshot = await f.snapshots.capture(f.record, f.guard)
    const capture = vi.spyOn(f.snapshots, 'capture'),
      restore = vi.spyOn(f.snapshots, 'restore')
    const readTree = vi.spyOn(trees, 'readTaskCodeTree')
    const first = await f.snapshots.getCodePage(snapshot.version, f.record, f.query, f.guard)
    expect(first.files).toHaveLength(50)
    expect(first.nextCursor).toEqual({
      snapshotRef: snapshot.version.snapshot.artifactRef,
      afterPath: first.files.at(-1)?.path
    })
    expect(readTree).toHaveBeenCalledOnce()
    if (!first.nextCursor) {
      throw new Error('Missing first data cursor')
    }
    const second = await f.snapshots.getCodePage(
      snapshot.version,
      f.record,
      { ...f.query, after: first.nextCursor },
      f.guard
    )
    if (!second.nextCursor) {
      throw new Error('Missing second data cursor')
    }
    const third = await f.snapshots.getCodePage(
      snapshot.version,
      f.record,
      { ...f.query, after: second.nextCursor },
      f.guard
    )
    expect([...first.files, ...second.files, ...third.files]).toEqual(snapshot.files)
    expect(third.nextCursor).toBeNull()
    expect(readTree).toHaveBeenCalledTimes(3)
    expect(capture).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
    const serialized = JSON.stringify(first)
    expect(serialized).not.toContain(f.root)
    expect(serialized).not.toContain('executionPath')
    expect(serialized).not.toContain('authorizationRef')
    await writeFile(join(f.project, 'src/app.ts'), 'live project changed')
    await writeFile(join(f.record.workspace.executionPath, 'src/app.ts'), 'later producer attempt')
    expect(
      (
        await f.snapshots.getCodeFile(
          snapshot.version,
          f.record,
          { ...f.query, path: 'src/app.ts' },
          f.guard
        )
      ).preview
    ).toEqual({ kind: 'text', text: 'export const original = true\n' })
  })

  it('reduces long Unicode metadata pages to the JSON byte budget while making stable progress', async () => {
    const f = await snapshotInspectionFixture()
    const components = Array.from({ length: 12 }, () => '甲'.repeat(80))
    const path = join(f.record.workspace.executionPath, ...components)
    await mkdir(path, { recursive: true })
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        writeFile(join(path, `${String(index).padStart(3, '0')}.ts`), 'bounded')
      )
    )
    const snapshot = await f.snapshots.capture(f.record, f.guard)
    const first = await f.snapshots.getCodePage(snapshot.version, f.record, f.query, f.guard)
    expect(first.files.length).toBeGreaterThan(0)
    expect(first.files.length).toBeLessThan(50)
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(
      HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.pageBytes
    )
    if (!first.nextCursor) {
      throw new Error('Missing bounded data cursor')
    }
    const second = await f.snapshots.getCodePage(
      snapshot.version,
      f.record,
      { ...f.query, after: first.nextCursor },
      f.guard
    )
    expect([...first.files, ...second.files]).toEqual(snapshot.files)
    expect(second.nextCursor).toBeNull()
  })

  it('rejects foreign versions, unknown/directory cursors, arbitrary member paths and producer substitution', async () => {
    const f = await snapshotInspectionFixture(),
      foreign = await snapshotInspectionFixture()
    const snapshot = await f.snapshots.capture(f.record, f.guard)
    const other = await foreign.snapshots.capture(foreign.record, foreign.guard)
    for (const after of [
      { snapshotRef: other.version.snapshot.artifactRef, afterPath: 'dirty.ts' },
      { snapshotRef: snapshot.version.snapshot.artifactRef, afterPath: 'missing.ts' },
      { snapshotRef: snapshot.version.snapshot.artifactRef, afterPath: 'src' }
    ]) {
      await expect(
        f.snapshots.getCodePage(snapshot.version, f.record, { ...f.query, after }, f.guard)
      ).rejects.toThrow()
    }
    for (const path of [
      'missing.ts',
      'src',
      '../manifest.json',
      '/native/secret',
      'C:/native/secret'
    ]) {
      await expect(
        f.snapshots.getCodeFile(snapshot.version, f.record, { ...f.query, path }, f.guard)
      ).rejects.toThrow()
    }
    await expect(
      f.snapshots.getCodePage(snapshot.version, foreign.record, f.query, f.guard)
    ).rejects.toThrow('FORBIDDEN')
  })

  it('preserves fatal-decoded UTF-8 BOM and empty files, and returns explicit binary observations', async () => {
    const f = await snapshotInspectionFixture()
    for (const [name, bytes] of Object.entries({
      'bom.ts': Buffer.from('\uFEFFexport const bom = true\n'),
      'empty.ts': Buffer.alloc(0),
      'invalid.bin': Buffer.from([0xc3, 0x28]),
      'nul.bin': Buffer.from('valid\u0000binary')
    })) {
      await writeFile(join(f.record.workspace.executionPath, name), bytes)
    }
    const snapshot = await f.snapshots.capture(f.record, f.guard)
    const file = (path: string) =>
      f.snapshots.getCodeFile(snapshot.version, f.record, { ...f.query, path }, f.guard)
    expect((await file('bom.ts')).preview).toEqual({
      kind: 'text',
      text: '\uFEFFexport const bom = true\n'
    })
    expect((await file('empty.ts')).preview).toEqual({ kind: 'text', text: '' })
    expect((await file('invalid.bin')).preview).toEqual({ kind: 'unavailable', reason: 'binary' })
    expect((await file('nul.bin')).preview).toEqual({ kind: 'unavailable', reason: 'binary' })
  })

  it('includes exact preview limit bytes and returns metadata-only oversized members without a second member read', async () => {
    const f = await snapshotInspectionFixture()
    const maximum = HIVE_WORKFLOW_CODE_INSPECTION_LIMITS.previewBytes
    await writeFile(join(f.record.workspace.executionPath, 'edge.txt'), Buffer.alloc(maximum, 'x'))
    await writeFile(
      join(f.record.workspace.executionPath, 'large.txt'),
      Buffer.alloc(maximum + 1, 'x')
    )
    const snapshot = await f.snapshots.capture(f.record, f.guard)
    const read = vi.spyOn(artifacts, 'readTaskArtifactFile')
    const edge = await f.snapshots.getCodeFile(
      snapshot.version,
      f.record,
      { ...f.query, path: 'edge.txt' },
      f.guard
    )
    expect(edge.preview.kind).toBe('text')
    if (edge.preview.kind === 'text') {
      expect(Buffer.byteLength(edge.preview.text)).toBe(maximum)
    }
    expect(read.mock.calls.filter(([, name]) => name === 'edge.txt')).toHaveLength(2)
    read.mockClear()
    const large = await f.snapshots.getCodeFile(
      snapshot.version,
      f.record,
      { ...f.query, path: 'large.txt' },
      f.guard
    )
    expect(large.file.size).toBe(maximum + 1)
    expect(large.preview).toEqual({ kind: 'unavailable', reason: 'too_large' })
    expect(read.mock.calls.filter(([, name]) => name === 'large.txt')).toHaveLength(1)
  })

  it.each(['size', 'digest'])(
    'checks selected original member %s beyond full tree validation',
    async (boundary) => {
      const f = await snapshotInspectionFixture()
      const snapshot = await f.snapshots.capture(f.record, f.guard)
      const original = artifacts.readTaskArtifactFile
      let reads = 0
      vi.spyOn(artifacts, 'readTaskArtifactFile').mockImplementation(
        async (root, name, maximum) => {
          const data = await original(root, name, maximum)
          if (name === 'src/app.ts' && ++reads === 2) {
            return Buffer.alloc(data.length + (boundary === 'size' ? 1 : 0), 'z')
          }
          return data
        }
      )
      await expect(
        f.snapshots.getCodeFile(
          snapshot.version,
          f.record,
          { ...f.query, path: 'src/app.ts' },
          f.guard
        )
      ).rejects.toThrow('OUTCOME_UNKNOWN')
    }
  )

  it.each(['missing', 'tamper', 'symlink', 'hardlink', 'directory_replacement'])(
    'rejects corrupted immutable filesystem source: %s',
    async (kind) => {
      const f = await snapshotInspectionFixture()
      const snapshot = await f.snapshots.capture(f.record, f.guard)
      const root = join(f.artifacts, 'code-snapshots', snapshot.version.snapshot.digest, 'tree')
      const file = join(root, 'src/app.ts')
      await chmod(file, 0o600)
      if (kind === 'missing') {
        await rm(file)
      }
      if (kind === 'tamper') {
        await writeFile(file, 'changed immutable snapshot')
      }
      if (kind === 'symlink' && process.platform === 'win32') {
        await rm(join(root, 'src'), { recursive: true, force: true })
        await symlink(join(f.record.workspace.executionPath, 'src'), join(root, 'src'), 'junction')
      } else if (kind === 'symlink' || kind === 'hardlink') {
        await rm(file)
        const source = join(f.record.workspace.executionPath, 'src/app.ts')
        await (kind === 'symlink' ? symlink(source, file) : link(source, file))
      }
      if (kind === 'directory_replacement') {
        await rename(join(root, 'src'), join(root, 'src-original'))
        await mkdir(join(root, 'src'))
        await writeFile(file, 'replacement')
      }
      await expect(
        f.snapshots.getCodePage(snapshot.version, f.record, f.query, f.guard)
      ).rejects.toThrow()
      await expect(
        f.snapshots.getCodeFile(
          snapshot.version,
          f.record,
          { ...f.query, path: 'src/app.ts' },
          f.guard
        )
      ).rejects.toThrow()
    }
  )

  it('returns an empty terminal page for a verified snapshot with no file members', async () => {
    const f = await snapshotInspectionFixture()
    await rm(join(f.record.workspace.executionPath, 'src/app.ts'))
    await rm(join(f.record.workspace.executionPath, 'dirty.ts'))
    const snapshot = await f.snapshots.capture(f.record, f.guard)
    expect(snapshot.files).toEqual([])
    expect(
      await f.snapshots.getCodePage(snapshot.version, f.record, f.query, f.guard)
    ).toMatchObject({
      codeVersion: snapshot.version,
      files: [],
      nextCursor: null
    })
  })

  it('rechecks original owner authority after the awaited selected-member read', async () => {
    const f = await snapshotInspectionFixture()
    const snapshot = await f.snapshots.capture(f.record, f.guard)
    const original = artifacts.readTaskArtifactFile
    let reads = 0
    vi.spyOn(artifacts, 'readTaskArtifactFile').mockImplementation(async (root, name, maximum) => {
      const data = await original(root, name, maximum)
      if (name === 'src/app.ts' && ++reads === 2) {
        f.revoke()
      }
      return data
    })
    await expect(
      f.snapshots.getCodeFile(
        snapshot.version,
        f.record,
        { ...f.query, path: 'src/app.ts' },
        f.guard
      )
    ).rejects.toThrow('FORBIDDEN')
  })

  it('rechecks owner authority after source verification and refuses asynchronous/boolean guards', async () => {
    const f = await snapshotInspectionFixture()
    const snapshot = await f.snapshots.capture(f.record, f.guard)
    const original = trees.readTaskCodeTree
    vi.spyOn(trees, 'readTaskCodeTree').mockImplementation(async (...args) => {
      const source = await original(...args)
      f.revoke()
      return source
    })
    await expect(
      f.snapshots.getCodePage(snapshot.version, f.record, f.query, f.guard)
    ).rejects.toThrow('FORBIDDEN')
    for (const guard of [() => true, async () => undefined]) {
      await expect(
        f.snapshots.getCodePage(snapshot.version, f.record, f.query, guard)
      ).rejects.toThrow('FORBIDDEN')
      await expect(
        f.snapshots.getCodeFile(
          snapshot.version,
          f.record,
          { ...f.query, path: 'src/app.ts' },
          guard
        )
      ).rejects.toThrow('FORBIDDEN')
    }
  })

  it('retains snapshot guards across selected member I/O', async () => {
    const f = await snapshotInspectionFixture()
    const snapshot = await f.snapshots.capture(f.record, f.guard)
    const original = artifacts.readTaskArtifactFile
    let reads = 0
    vi.spyOn(artifacts, 'readTaskArtifactFile').mockImplementation(async (root, name, maximum) => {
      const data = await original(root, name, maximum)
      if (name === 'src/app.ts' && ++reads === 2) {
        const path = join(root, ...name.split('/'))
        await chmod(path, 0o600)
        writeFileSync(path, 'concurrent immutable mutation')
      }
      return data
    })
    await expect(
      f.snapshots.getCodeFile(
        snapshot.version,
        f.record,
        { ...f.query, path: 'src/app.ts' },
        f.guard
      )
    ).rejects.toThrow('REVISION_CONFLICT')
  })
})
