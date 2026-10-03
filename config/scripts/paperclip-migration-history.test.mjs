import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  canonicalizePaperclipMigrationFiles,
  paperclipMigrationDigests,
  reconcilePaperclipMigrationHashes
} from '../../integration/paperclip/service/migration-history.mjs'

async function migrationFixture(content = 'SELECT 1;\n') {
  const root = resolve('logs/paperclip-prerequisites/migration-history-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'case-'))
  const file = join(directory, '0000_fixture.sql')
  await writeFile(file, content, 'utf8')
  return { directory, file, ...paperclipMigrationDigests(content) }
}
function sqlFixture(rows, tables = [{ table_schema: 'drizzle' }]) {
  const updates = []
  const transaction = Object.assign(
    async (parts) => (parts.join('').includes('information_schema.tables') ? tables : []),
    {
      unsafe: vi.fn(async (query, parameters) => {
        if (query.startsWith('SELECT')) {
          return rows
        }
        updates.push({ query, parameters })
        return []
      })
    }
  )
  return { sql: { begin: vi.fn(async (callback) => callback(transaction)) }, updates }
}

describe('Paperclip migration newline and journal invariants', () => {
  it('gives LF and CRLF SQL the same canonical digest with a verifiable Windows alias', () => {
    const first = paperclipMigrationDigests('SELECT 1;\nSELECT 2;\n')
    const second = paperclipMigrationDigests('SELECT 1;\r\nSELECT 2;\r\n')
    expect(first).toEqual(second)
    expect(first.sha256).not.toBe(first.windowsSha256)
  })
  it('canonicalizes SQL build outputs while preserving the migration journal bytes', async () => {
    const { directory, file } = await migrationFixture('SELECT 1;\r\n')
    const journal = join(directory, 'journal.json')
    await writeFile(journal, '{"unchanged":true}\r\n')
    await canonicalizePaperclipMigrationFiles(directory)
    expect(await readFile(file, 'utf8')).toBe('SELECT 1;\n')
    expect(await readFile(journal, 'utf8')).toBe('{"unchanged":true}\r\n')
  })
  it('corrects only the hash of a proven CRLF migration without changing its identity', async () => {
    const fixture = await migrationFixture()
    const { sql, updates } = sqlFixture([{ id: 7, hash: fixture.windowsSha256 }])
    expect(await reconcilePaperclipMigrationHashes(sql, fixture.directory)).toBe(1)
    expect(updates).toEqual([
      {
        query: 'UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2 AND hash=$3',
        parameters: [fixture.sha256, 7, fixture.windowsSha256]
      }
    ])
  })
  it('performs no writes for a fresh database or canonical existing history', async () => {
    const fixture = await migrationFixture()
    const fresh = sqlFixture([], [])
    expect(await reconcilePaperclipMigrationHashes(fresh.sql, fixture.directory)).toBe(0)
    expect(fresh.updates).toEqual([])
    const current = sqlFixture([{ id: 7, hash: fixture.sha256 }])
    expect(await reconcilePaperclipMigrationHashes(current.sql, fixture.directory)).toBe(0)
    expect(current.updates).toEqual([])
  })
  it('refuses the entire history before writes when even one hash has no byte-equivalence proof', async () => {
    const fixture = await migrationFixture()
    const { sql, updates } = sqlFixture([
      { id: 1, hash: fixture.windowsSha256 },
      { id: 2, hash: '0'.repeat(64) }
    ])
    await expect(reconcilePaperclipMigrationHashes(sql, fixture.directory)).rejects.toThrow(
      'PAPERCLIP_MIGRATION_HISTORY_UNVERIFIED'
    )
    expect(updates).toEqual([])
  })
  it('refuses uncanonical runtime assets before opening a journal transaction', async () => {
    const { directory } = await migrationFixture('SELECT 1;\r\n')
    const { sql } = sqlFixture([])
    await expect(reconcilePaperclipMigrationHashes(sql, directory)).rejects.toThrow(
      'PAPERCLIP_MIGRATION_BYTES_NOT_CANONICAL'
    )
    expect(sql.begin).not.toHaveBeenCalled()
  })
  it('refuses ambiguous journal tables and oversized history', async () => {
    const fixture = await migrationFixture()
    const ambiguous = sqlFixture([], [{ table_schema: 'drizzle' }, { table_schema: 'public' }])
    await expect(
      reconcilePaperclipMigrationHashes(ambiguous.sql, fixture.directory)
    ).rejects.toThrow('PAPERCLIP_MIGRATION_HISTORY_AMBIGUOUS')
    expect(ambiguous.updates).toEqual([])
    const oversized = sqlFixture(
      Array.from({ length: 513 }, (_, index) => ({ id: index + 1, hash: fixture.sha256 }))
    )
    await expect(
      reconcilePaperclipMigrationHashes(oversized.sql, fixture.directory)
    ).rejects.toThrow('PAPERCLIP_MIGRATION_HISTORY_INVALID')
    expect(oversized.updates).toEqual([])
  })
})
