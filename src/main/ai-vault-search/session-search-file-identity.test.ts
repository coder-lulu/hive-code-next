import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import SyncDatabase from '../sqlite/sync-database'
import { resetTranscriptConsumersForTests } from '../ai-vault/session-transcript-consumers'
import { fileIdentity } from './session-search-file-cursor'
import { registerSessionSearchIndexConsumer } from './session-search-index-consumer'
import {
  openSessionSearchIndexFile,
  replayTranscriptRead,
  syntheticCandidate,
  syntheticSession,
  userMessages,
  type SessionSearchIndexFile
} from './session-search-index-test-fixture'
import { SessionSearchStore } from './session-search-store'

const FIRST_INODE = 9_007_199_254_740_992n
const SECOND_INODE = FIRST_INODE + 1n
let index: SessionSearchIndexFile
let store: SessionSearchStore
let errors: unknown[]

beforeEach(async () => {
  index = await openSessionSearchIndexFile('ss-file-identity')
  errors = []
  store = new SessionSearchStore(index.path, (error) => errors.push(error))
})

afterEach(async () => {
  resetTranscriptConsumersForTests()
  store.close()
  await index.close()
})

function candidate(ino: bigint) {
  return syntheticCandidate({
    dev: 42,
    ino: Number(ino),
    filesystemIdentity: { dev: '42', ino: String(ino) }
  })
}

function write(ino: bigint): void {
  const opened = store.beginWrite(candidate(ino), 'replace', 0)!
  opened.add(userMessages('originalneedle', 1)[0]!)
  expect(opened.commit({ session: syntheticSession(), byteOffset: 50, incomplete: false })).toBe(true)
}

it('distinguishes adjacent exact inodes that numeric discovery rounds together', () => {
  expect(Number(FIRST_INODE)).toBe(Number(SECOND_INODE))
  write(FIRST_INODE)
  expect(store.indexedFile(candidate(FIRST_INODE).file.path, fileIdentity(candidate(FIRST_INODE).file)))
    .toMatchObject({ byteOffset: 50 })
  expect(store.indexedFile(candidate(SECOND_INODE).file.path, fileIdentity(candidate(SECOND_INODE).file)))
    .toBeNull()
  expect(errors).toEqual([])
})

it('round-trips a uint64 inode across handles and store reopen without unsafe integer reads', () => {
  const ino = 18_446_744_073_709_551_615n
  write(ino)
  expect(index.db.prepare('SELECT dev, ino, typeof(ino) AS storage FROM files').get()).toEqual({
    dev: '42', ino: String(ino), storage: 'text'
  })
  store.close()
  store = new SessionSearchStore(index.path, (error) => errors.push(error))
  expect(store.files()[0]?.identity).toEqual({ dev: 42, ino: String(ino) })
  expect(store.indexedFile(candidate(ino).file.path, fileIdentity(candidate(ino).file)))
    .toMatchObject({ byteOffset: 50 })
  expect(errors).toEqual([])
})

it('refuses an append from a replacement inode even at the same size, time and byte offset', () => {
  write(FIRST_INODE)
  registerSessionSearchIndexConsumer(store)
  replayTranscriptRead({
    candidate: candidate(SECOND_INODE), mode: 'append', previousByteOffset: 50,
    messages: userMessages('replacementneedle', 1), outcome: { byteOffset: 100 }
  })
  expect(index.db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 1 })
  expect(store.files()[0]?.state).toBe('due')
  expect(errors).toEqual([])
})

it('does not guess an exact identity from an unsafe numeric-only observation', () => {
  expect(() => fileIdentity(syntheticCandidate({ dev: 42, ino: Number(SECOND_INODE) }).file))
    .toThrow(/identity/i)
})

it('rebuilds a v5 INTEGER identity cache through the supported schema-version boundary', () => {
  const path = join(dirname(index.path), 'legacy.sqlite')
  const legacy = new SyncDatabase(path)
  legacy.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO meta VALUES ('schema_version', '5');
    CREATE TABLE files(path TEXT PRIMARY KEY, dev INTEGER, ino INTEGER,
      byte_offset INTEGER NOT NULL, mtime_ms REAL NOT NULL, size_bytes INTEGER,
      session_row_id INTEGER, state TEXT NOT NULL DEFAULT 'current',
      fail_count INTEGER NOT NULL DEFAULT 0, failed_mtime_ms REAL);
  `)
  legacy.prepare('INSERT INTO files(path,dev,ino,byte_offset,mtime_ms) VALUES (?,?,?,?,?)')
    .run('old-transcript', 42, SECOND_INODE, 50, 1000)
  legacy.close()
  const rebuilt = new SessionSearchStore(path)
  try {
    expect(rebuilt.files()).toEqual([])
    const columns = rebuilt.connection.pragma('table_info(files)') as { name: string; type: string }[]
    expect(columns.filter((column) => column.name === 'dev' || column.name === 'ino')
      .map((column) => column.type)).toEqual(['TEXT', 'TEXT'])
  } finally {
    rebuilt.close()
  }
})
