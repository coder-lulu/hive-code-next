import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Freeze the actual DB/shared source and migration bytes, not just .git/HEAD. */
export async function paperclipDatabaseSourceDigest(source) {
  const files = [
    'packages/db/package.json',
    'packages/shared/package.json',
    'pnpm-lock.yaml',
    'LICENSE'
  ]
  const visit = async (path, depth = 0) => {
    if (depth > 16 || files.length > 2048) {
      throw new Error('Paperclip source exceeds the audited scope')
    }
    if ((await lstat(join(source, path))).isSymbolicLink()) {
      throw new Error('Paperclip source links are forbidden')
    }
    for (const entry of await readdir(join(source, path), { withFileTypes: true })) {
      const name = `${path}/${entry.name}`
      if (entry.isDirectory()) {
        await visit(name, depth + 1)
      } else if (entry.isFile()) {
        files.push(name)
      } else {
        throw new Error('Unexpected Paperclip source file')
      }
    }
  }
  await visit('packages/db/src')
  await visit('packages/shared/src')
  const hash = createHash('sha256')
  for (const path of files.sort()) {
    const content = await readFile(join(source, path), 'utf8')
    if (content.length > 16 * 1024 * 1024) {
      throw new Error('Paperclip source file exceeds the audited scope')
    }
    hash.update(
      `${path}\n${createHash('sha256').update(content.replaceAll('\r\n', '\n')).digest('hex')}\n`
    )
  }
  return hash.digest('hex')
}
