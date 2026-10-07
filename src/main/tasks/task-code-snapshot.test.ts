import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { chmod, link, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskCodeSnapshotStore } from './task-code-snapshot'
import { taskResultManifestName } from './task-artifact-index'
import { codeSnapshotFixture } from './task-code-snapshot.test-fixture'

const roots: string[] = []
afterEach(async () => {
  closeTestJournalHostDatabases()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture(status: 'succeeded' | 'failed' = 'succeeded') {
  const f = await codeSnapshotFixture(status)
  roots.push(f.root)
  return { ...f, snapshots: new TaskCodeSnapshotStore(f.artifacts) }
}

describe('host-owned complete code snapshots', () => {
  it.each([() => true, async () => undefined])(
    'refuses a boolean or asynchronous host guard',
    async (guard) => {
      const f = await fixture()
      await expect(f.snapshots.capture(f.record, guard)).rejects.toThrow('FORBIDDEN')
      expect(existsSync(f.artifacts)).toBe(false)
    }
  )

  it('rejects changed original source during capture without publishing a mixed version', async () => {
    const f = await fixture()
    let changed = false
    await expect(
      f.snapshots.capture(f.record, () => {
        if (!changed && existsSync(f.artifacts)) {
          changed = true
          writeFileSync(join(f.record.workspace.executionPath, 'src/app.ts'), 'concurrent writer')
        }
      })
    ).rejects.toThrow('REVISION_CONFLICT')
    expect(changed).toBe(true)
    expect(readdirSync(join(f.artifacts, 'code-snapshots'))).toEqual([])
  })

  it('observes owner revocation during managed-copy restoration and removes only its partial copy', async () => {
    const f = await fixture(),
      snapshot = await f.snapshots.capture(f.record)
    let revoked = false
    await expect(
      f.snapshots.restore(snapshot.version, f.record, f.consumers, () => {
        if (existsSync(f.consumers) && readdirSync(f.consumers).length) {
          revoked = true
          throw new Error('FORBIDDEN')
        }
      })
    ).rejects.toThrow('FORBIDDEN')
    expect(revoked).toBe(true)
    expect(readdirSync(f.consumers)).toEqual([])
    expect((await f.snapshots.readSource(snapshot.version, f.record)).treeDigest).toBe(
      snapshot.version.treeDigest
    )
  })

  it('offers a directory guard for mutable developer copies while the strict tree guard rejects edits', async () => {
    const f = await fixture(),
      snapshot = await f.snapshots.capture(f.record)
    let revoked = false
    const restored = await f.snapshots.restore(snapshot.version, f.record, f.consumers, () => {
      if (revoked) {
        throw new Error('FORBIDDEN')
      }
    })
    await writeFile(join(restored.executionPath, 'src/app.ts'), 'developer retry edits')
    restored.assertDirectoryCurrent()
    expect(() => restored.assertCurrent()).toThrow('REVISION_CONFLICT')
    revoked = true
    expect(() => restored.assertDirectoryCurrent()).toThrow('FORBIDDEN')
  })
  it('retains failed terminal status for diagnosis instead of marking its code approved', async () => {
    const f = await fixture('failed')
    const snapshot = await f.snapshots.capture(f.record)
    expect(snapshot.producer.status).toBe('failed')
    expect(snapshot.producer.outcomeRef).toBe(f.record.result?.outcomeRef)
  })

  it('rejects a complete original terminal record belonging to another producer and owner', async () => {
    const f = await fixture(),
      foreign = await fixture()
    const snapshot = await f.snapshots.capture(f.record)
    await expect(f.snapshots.readSource(snapshot.version, foreign.record)).rejects.toThrow(
      'FORBIDDEN'
    )
  })

  it('refuses artifact publication inside the original execution tree', async () => {
    const f = await fixture()
    const nested = join(f.record.workspace.executionPath, 'assets')
    await expect(new TaskCodeSnapshotStore(nested).capture(f.record)).rejects.toThrow('FORBIDDEN')
    expect(existsSync(nested)).toBe(false)
  })
  it('captures all modified, new, nested and binary files rather than a model artifact selection', async () => {
    const f = await fixture()
    const source = f.record.workspace.executionPath
    await writeFile(join(source, 'src/app.ts'), 'developer changed implementation\n')
    await writeFile(join(source, 'untracked.bin'), Buffer.from([0, 255, 42]))
    await mkdir(join(source, 'empty'))
    await rm(join(source, 'dirty.ts'))
    const snapshot = await f.snapshots.capture(f.record)
    expect(snapshot.files.map((file) => file.path)).toEqual(['src/app.ts', 'untracked.bin'])
    expect(snapshot.directories).toEqual(['empty', 'src'])
    expect(snapshot.producer).toMatchObject({
      task: f.record.command.task,
      runtimeRecordId: f.record.command.runtimeRecordId,
      ownershipEpoch: f.record.command.ownershipEpoch,
      executionId: f.record.command.executionId,
      commandFingerprint: f.record.commandFingerprint,
      operationId: f.record.command.operationId,
      ownerScope: f.record.command.ownerScope,
      outcomeRef: f.record.result?.outcomeRef,
      status: 'succeeded'
    })
    expect(snapshot.version).toMatchObject({ kind: 'snapshot', snapshot: { artifactRevision: 1 } })
    const restored = await f.snapshots.restore(snapshot.version, f.record, f.consumers)
    expect(await readFile(join(restored.executionPath, 'src/app.ts'), 'utf8')).toBe(
      'developer changed implementation\n'
    )
    expect(await readFile(join(restored.executionPath, 'untracked.bin'))).toEqual(
      Buffer.from([0, 255, 42])
    )
    expect(existsSync(join(restored.executionPath, 'dirty.ts'))).toBe(false)
    expect(existsSync(join(restored.executionPath, 'empty'))).toBe(true)
    expect(restored.treeDigest).toBe(snapshot.version.treeDigest)
    expect(restored.directoryIdentity.ino).not.toBe(f.record.workspace.directoryIdentity?.ino)
  })

  it('restores the captured old version after both the live Project and original execution tree change', async () => {
    const f = await fixture(),
      snapshot = await f.snapshots.capture(f.record)
    await writeFile(join(f.project, 'src/app.ts'), 'live project latest')
    await writeFile(join(f.record.workspace.executionPath, 'src/app.ts'), 'later execution write')
    await writeFile(
      join(f.record.workspace.executionPath, 'later.ts'),
      'must not enter frozen version'
    )
    const restored = await f.snapshots.restore(snapshot.version, f.record, f.consumers)
    expect(await readFile(join(restored.executionPath, 'src/app.ts'), 'utf8')).toBe(
      'export const original = true\n'
    )
    expect(existsSync(join(restored.executionPath, 'later.ts'))).toBe(false)
    restored.assertCurrent()
  })

  it('publishes the same complete producer/version idempotently and changes its version when source changes', async () => {
    const f = await fixture()
    const first = await f.snapshots.capture(f.record)
    expect(await f.snapshots.capture(f.record)).toEqual(first)
    await writeFile(join(f.record.workspace.executionPath, 'src/app.ts'), 'new version')
    const changed = await f.snapshots.capture(f.record)
    expect(changed.version.treeDigest).not.toBe(first.version.treeDigest)
    expect(changed.version.snapshot.artifactRef).not.toBe(first.version.snapshot.artifactRef)
    const old = await f.snapshots.restore(first.version, f.record, f.consumers)
    expect(await readFile(join(old.executionPath, 'src/app.ts'), 'utf8')).toBe(
      'export const original = true\n'
    )
  })

  it('omits only the declared runtime directories and this exact Task result manifest', async () => {
    const f = await fixture(),
      source = f.record.workspace.executionPath
    for (const name of ['.git', 'node_modules', 'logs']) {
      await mkdir(join(source, name))
      await writeFile(join(source, name, 'private-or-rebuildable.txt'), 'omitted')
    }
    await writeFile(
      join(source, taskResultManifestName(f.record.commandFingerprint)),
      'original runtime manifest'
    )
    await writeFile(join(source, '.hive-task-result-other.json'), 'ordinary unrelated code remains')
    await writeFile(join(source, 'implementation.md'), 'ordinary report remains')
    const snapshot = await f.snapshots.capture(f.record)
    expect(snapshot.files.map((file) => file.path)).toEqual([
      '.hive-task-result-other.json',
      'dirty.ts',
      'implementation.md',
      'src/app.ts'
    ])
    expect(snapshot.omissions).toEqual({
      directories: ['.git', 'node_modules', 'logs'],
      runtimeManifest: taskResultManifestName(f.record.commandFingerprint)
    })
  })

  it('preserves ordinary files named logs or node_modules', async () => {
    const f = await fixture()
    await writeFile(join(f.record.workspace.executionPath, 'logs'), 'ordinary source file')
    await writeFile(join(f.record.workspace.executionPath, 'node_modules'), 'ordinary source file')
    const snapshot = await f.snapshots.capture(f.record)
    expect(snapshot.files.map((file) => file.path)).toContain('logs')
    expect(snapshot.files.map((file) => file.path)).toContain('node_modules')
  })

  it.each(['traversal', 'entries', 'totalBytes'])(
    'rejects corrupt metadata with a matching caller-provided digest: %s',
    async (boundary) => {
      const f = await fixture(),
        snapshot = await f.snapshots.capture(f.record)
      const source = await f.snapshots.readSource(snapshot.version, f.record)
      const original = JSON.parse(
        await readFile(join(dirname(source.path), 'manifest.json'), 'utf8')
      )
      if (boundary === 'traversal') {
        original.tree.files[0].path = '../outside.ts'
      } else if (boundary === 'entries') {
        original.tree.files = Array.from({ length: 20_001 }, (_, index) => ({
          ...original.tree.files[0],
          path: `file-${index}.ts`
        }))
      } else {
        original.tree.files = Array.from({ length: 33 }, (_, index) => ({
          ...original.tree.files[0],
          path: `file-${index}.bin`,
          size: 8 * 1024 * 1024
        }))
      }
      const bytes = Buffer.from(JSON.stringify(original))
      const digest = createHash('sha256').update(bytes).digest('hex')
      const directory = join(f.artifacts, 'code-snapshots', digest)
      await mkdir(directory)
      await writeFile(join(directory, 'manifest.json'), bytes)
      const version = {
        ...snapshot.version,
        snapshot: { ...snapshot.version.snapshot, artifactRef: `artifact:${digest}`, digest }
      }
      await expect(f.snapshots.restore(version, f.record, f.consumers)).rejects.toThrow(
        'OUTCOME_UNKNOWN'
      )
      expect(existsSync(f.consumers)).toBe(false)
    }
  )

  it('does not archive an unsettled original Task', async () => {
    const f = await fixture()
    await expect(f.snapshots.capture(f.unsettled)).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(existsSync(f.artifacts)).toBe(false)
  })

  it.each(['not_started', 'writersFenced', 'managedToolsSettled', 'cancelled', 'outcome_unknown'])(
    'rejects incomplete terminal authority: %s',
    async (boundary) => {
      const f = await fixture(),
        record = structuredClone(f.record)
      if (boundary === 'cancelled' || boundary === 'outcome_unknown') {
        Reflect.set(record, 'status', boundary)
      } else if (boundary === 'not_started') {
        Reflect.set(record.result?.stopProof ?? {}, 'evidenceKind', boundary)
      } else {
        Reflect.set(record.result?.stopProof ?? {}, boundary, false)
      }
      await expect(f.snapshots.capture(record)).rejects.toThrow('OUTCOME_UNKNOWN')
      expect(existsSync(f.artifacts)).toBe(false)
    }
  )

  it.each([
    'ownerScope',
    'task',
    'runtimeRecordId',
    'ownershipEpoch',
    'executionId',
    'operationId',
    'outcomeRef'
  ])('refuses a snapshot for another expected producer %s', async (boundary) => {
    const f = await fixture(),
      snapshot = await f.snapshots.capture(f.record),
      foreign = await fixture()
    const changed = structuredClone(f.record)
    if (boundary === 'outcomeRef') {
      Reflect.set(changed.result ?? {}, boundary, foreign.record.result?.outcomeRef)
    } else if (boundary === 'ownershipEpoch') {
      changed.command.ownershipEpoch += 1
    } else {
      Reflect.set(changed.command, boundary, Reflect.get(foreign.record.command, boundary))
    }
    await expect(f.snapshots.readSource(snapshot.version, changed)).rejects.toThrow()
  })

  it.each(['artifactRef', 'digest', 'treeDigest', 'artifactRevision'])(
    'rejects a changed version %s without trusting caller hashes',
    async (boundary) => {
      const f = await fixture(),
        snapshot = await f.snapshots.capture(f.record),
        version = structuredClone(snapshot.version)
      if (boundary === 'treeDigest') {
        version.treeDigest = 'f'.repeat(64)
      } else {
        Reflect.set(
          version.snapshot,
          boundary,
          boundary === 'artifactRevision'
            ? 2
            : boundary === 'artifactRef'
              ? `artifact:${'f'.repeat(64)}`
              : 'f'.repeat(64)
        )
      }
      await expect(f.snapshots.restore(version, f.record, f.consumers)).rejects.toThrow()
      expect(existsSync(f.consumers)).toBe(false)
    }
  )

  it.each(['missing', 'extra', 'bytes'])(
    'rejects an actually corrupted stored snapshot: %s',
    async (boundary) => {
      const f = await fixture(),
        snapshot = await f.snapshots.capture(f.record)
      const source = await f.snapshots.readSource(snapshot.version, f.record)
      await chmod(source.path, 0o700)
      const file = join(source.path, 'src/app.ts')
      await chmod(file, 0o600)
      if (boundary === 'missing') {
        await rm(file)
      } else if (boundary === 'extra') {
        await writeFile(join(source.path, 'extra.ts'), 'foreign source')
      } else {
        await writeFile(file, 'tampered bytes')
      }
      expect(() => source.assertCurrent()).toThrow()
      await expect(f.snapshots.restore(snapshot.version, f.record, f.consumers)).rejects.toThrow()
      expect(existsSync(f.consumers)).toBe(false)
    }
  )

  it('fences replacement of a snapshot or restored execution directory', async () => {
    const f = await fixture(),
      snapshot = await f.snapshots.capture(f.record)
    const source = await f.snapshots.readSource(snapshot.version, f.record)
    const restored = await f.snapshots.restore(snapshot.version, f.record, f.consumers)
    await rename(source.path, `${source.path}-original`)
    await mkdir(source.path)
    expect(() => source.assertCurrent()).toThrow('FORBIDDEN')
    await rename(restored.executionPath, `${restored.executionPath}-original`)
    await mkdir(restored.executionPath)
    expect(() => restored.assertCurrent()).toThrow('FORBIDDEN')
  })

  it.each(['symlink', 'hardlink'])(
    'rejects %s source entries rather than archiving another inode',
    async (boundary) => {
      const f = await fixture(),
        outside = join(f.root, 'outside.ts')
      await writeFile(outside, 'outside source must not be copied')
      const target = join(f.record.workspace.executionPath, 'escape.ts')
      await (boundary === 'symlink' ? symlink(f.root, target, 'junction') : link(outside, target))
      await expect(f.snapshots.capture(f.record)).rejects.toThrow()
    }
  )

  it('refuses a file beyond the existing 8 MiB bound before exposing a partial version', async () => {
    const f = await fixture()
    await writeFile(
      join(f.record.workspace.executionPath, 'too-large.bin'),
      Buffer.alloc(8 * 1024 * 1024 + 1)
    )
    await expect(f.snapshots.capture(f.record)).rejects.toThrow('CAPACITY_EXCEEDED')
  })

  it('rejects source directories deeper than the existing depth limit', async () => {
    const f = await fixture()
    await mkdir(join(f.record.workspace.executionPath, ...Array.from({ length: 65 }, () => 'd')), {
      recursive: true
    })
    await expect(f.snapshots.capture(f.record)).rejects.toThrow('CAPACITY_EXCEEDED')
  })
})
