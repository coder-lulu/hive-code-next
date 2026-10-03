import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_MIGRATIONS = 512
const MAX_SQL_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const digest = (value) => createHash('sha256').update(value).digest('hex')

export function paperclipMigrationDigests(content) {
  const canonical = content.replaceAll('\r\n', '\n')
  return {
    canonical,
    sha256: digest(canonical),
    windowsSha256: digest(canonical.replaceAll('\n', '\r\n'))
  }
}

async function migrationFiles(directory) {
  const path = directory instanceof URL ? fileURLToPath(directory) : directory
  const entries = (await readdir(path, { withFileTypes: true })).filter((entry) =>
    entry.name.endsWith('.sql')
  )
  if (entries.length > MAX_MIGRATIONS || entries.some((entry) => !entry.isFile())) {
    throw new Error('PAPERCLIP_MIGRATION_FILES_INVALID')
  }
  const files = []
  let bytes = 0
  for (const entry of entries) {
    const file = join(path, entry.name)
    const content = await readFile(file, 'utf8')
    const size = Buffer.byteLength(content)
    bytes += size
    if (size > MAX_SQL_BYTES || bytes > MAX_TOTAL_BYTES) {
      throw new Error('PAPERCLIP_MIGRATION_FILES_INVALID')
    }
    files.push({ file, content, ...paperclipMigrationDigests(content) })
  }
  return files
}

/** Build outputs only: source checkout and journal metadata retain their original bytes. */
export async function canonicalizePaperclipMigrationFiles(directory) {
  for (const file of await migrationFiles(directory)) {
    if (file.content !== file.canonical) {
      await writeFile(file.file, file.canonical, 'utf8')
    }
  }
}

/** Correct only exact LF/CRLF aliases in the existing upstream migration journal. */
export async function reconcilePaperclipMigrationHashes(sql, directory) {
  const aliases = new Map()
  for (const file of await migrationFiles(directory)) {
    if (file.content !== file.canonical) {
      throw new Error('PAPERCLIP_MIGRATION_BYTES_NOT_CANONICAL')
    }
    for (const hash of [file.sha256, file.windowsSha256]) {
      const previous = aliases.get(hash)
      if (previous && previous !== file.sha256) {
        throw new Error('PAPERCLIP_MIGRATION_HASH_AMBIGUOUS')
      }
      aliases.set(hash, file.sha256)
    }
  }
  return sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended('hive.paperclip.migration-history.v1', 0))`
    const tables = await transaction`SELECT table_schema FROM information_schema.tables
      WHERE table_name='__drizzle_migrations' AND table_schema IN ('drizzle','public')`
    if (!tables.length) {
      return 0
    }
    if (tables.length !== 1 || !['drizzle', 'public'].includes(tables[0].table_schema)) {
      throw new Error('PAPERCLIP_MIGRATION_HISTORY_AMBIGUOUS')
    }
    const table =
      tables[0].table_schema === 'drizzle'
        ? 'drizzle.__drizzle_migrations'
        : 'public.__drizzle_migrations'
    const rows = await transaction.unsafe(`SELECT id, hash FROM ${table} LIMIT 513 FOR UPDATE`)
    if (rows.length > MAX_MIGRATIONS) {
      throw new Error('PAPERCLIP_MIGRATION_HISTORY_INVALID')
    }
    const updates = []
    for (const row of rows) {
      const canonical = aliases.get(row.hash)
      if (!Number.isSafeInteger(row.id) || row.id < 1 || !canonical) {
        throw new Error('PAPERCLIP_MIGRATION_HISTORY_UNVERIFIED')
      }
      if (canonical !== row.hash) {
        updates.push({ ...row, canonical })
      }
    }
    // Validate the complete history before changing even one checksum.
    for (const update of updates) {
      await transaction.unsafe(`UPDATE ${table} SET hash=$1 WHERE id=$2 AND hash=$3`, [
        update.canonical,
        update.id,
        update.hash
      ])
    }
    return updates.length
  })
}
