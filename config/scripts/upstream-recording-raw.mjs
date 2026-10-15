import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve, sep, parse, posix } from 'node:path'
const SHA = /^[a-f0-9]{40}$/
const FOUNDATION = 'mobile/rpc-foundation'
export function requireValue(value, message) {
  if (!value) {
    throw new Error(message)
  }
}
export function exactKeys(value, keys, label) {
  requireValue(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
    `Invalid ${label} fields`
  )
}
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
export function git(cwd, args, input) {
  return execFileSync('git', ['--no-replace-objects', ...args], {
    cwd,
    input,
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' }
  })
}
export function guardedPath(path) {
  if (
    typeof path !== 'string' ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return false
  }
  return (
    path.startsWith('mobile/src/') ||
    path.startsWith('src/shared/') ||
    path === 'mobile/pnpm-lock.yaml' ||
    /^mobile\/rpc-foundation\/[^/]+\.ts$/.test(path) ||
    path === `${FOUNDATION}/pilot-scenarios.json` ||
    path === 'mobile/scripts/rpc-recording.mts'
  )
}
export function treeEntries(cwd, tree) {
  requireValue(SHA.test(tree), 'Projection requires an exact Git object SHA')
  const raw = git(cwd, ['ls-tree', '-r', '-z', tree])
  const entries = []
  let offset = 0
  while (offset < raw.length) {
    const end = raw.indexOf(0, offset)
    requireValue(end !== -1, 'Invalid Git tree entry')
    const record = raw.subarray(offset, end)
    offset = end + 1
    const tab = record.indexOf(9)
    const [mode, type, blob] = record.subarray(0, tab).toString('ascii').split(' ')
    const pathBytes = record.subarray(tab + 1)
    const path = pathBytes.toString('utf8')
    requireValue(
      Buffer.from(path).equals(pathBytes),
      'Non UTF-8 Git paths cannot be exported exactly'
    )
    entries.push({ path, mode, type, blob })
  }
  return entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
}
export function recordingProjection(cwd, tree) {
  const entries = treeEntries(cwd, tree)
    .filter((entry) => guardedPath(entry.path))
    .map(({ path, mode, type, blob }) => {
      requireValue(
        type === 'blob' && ['100644', '100755', '120000'].includes(mode),
        `Unsupported guarded mode: ${path}`
      )
      return { path, mode, blob }
    })
  requireValue(entries.length > 0, 'Empty guarded recording source projection')
  return {
    guardVersion: 1,
    guardedSourcesSha256: projectionDigest(entries),
    guardedFileCount: entries.length,
    entries
  }
}
function projectionDigest(entries) {
  const digest = createHash('sha256').update('hive-recording-guard-v1\0')
  for (const { path, mode, blob } of entries) {
    digest
      .update(Buffer.from(path))
      .update('\0')
      .update(mode)
      .update('\0')
      .update(blob)
      .update('\0')
  }
  return digest.digest('hex')
}
export function blobBytes(cwd, identities) {
  const blobs = [...new Set(identities)]
  const raw = git(cwd, ['cat-file', '--batch'], `${blobs.join('\n')}\n`)
  const bytes = new Map()
  let offset = 0
  for (const blob of blobs) {
    const end = raw.indexOf(10, offset)
    const [actual, type, sizeText] = raw.subarray(offset, end).toString('ascii').split(' ')
    const size = Number(sizeText)
    requireValue(
      actual === blob &&
        type === 'blob' &&
        Number.isSafeInteger(size) &&
        size >= 0 &&
        end + 1 + size < raw.length,
      'Invalid raw Git blob response'
    )
    bytes.set(blob, raw.subarray(end + 1, end + 1 + size))
    offset = end + 1 + size + 1
  }
  requireValue(offset === raw.length, 'Unexpected trailing Git blob data')
  return bytes
}
function validateProjection(projection) {
  exactKeys(
    projection,
    ['guardVersion', 'guardedSourcesSha256', 'guardedFileCount', 'entries'],
    'projection'
  )
  requireValue(
    projection.guardVersion === 1 &&
      Array.isArray(projection.entries) &&
      projection.entries.length > 0 &&
      projection.entries.length === projection.guardedFileCount,
    'Invalid projection count/version'
  )
  let previous = null
  for (const entry of projection.entries) {
    exactKeys(entry, ['path', 'mode', 'blob'], 'projection entry')
    requireValue(
      guardedPath(entry.path) &&
        ['100644', '100755', '120000'].includes(entry.mode) &&
        typeof entry.blob === 'string' &&
        SHA.test(entry.blob),
      'Invalid projection entry identity'
    )
    const current = Buffer.from(entry.path)
    requireValue(
      previous === null || Buffer.compare(previous, current) < 0,
      'Duplicate or unordered projection paths'
    )
    previous = current
  }
  requireValue(
    projection.guardedSourcesSha256 === projectionDigest(projection.entries),
    'Projection digest mismatch'
  )
}
function assertSafeParents(root, path) {
  const parts = path.split('/')
  parts.pop()
  let parent = resolve(root)
  for (const part of parts) {
    parent = join(parent, part)
    if (existsSync(parent)) {
      requireValue(
        lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink(),
        `Escaping source parent: ${path}`
      )
    }
  }
}
function assertPhysicalDirectoryRoot(root) {
  const absolute = resolve(root)
  let current = parse(absolute).root
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    try {
      const stat = lstatSync(current)
      requireValue(
        stat.isDirectory() && !stat.isSymbolicLink(),
        `Recording root/ancestor must be a physical directory: ${current}`
      )
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue
      }
      throw error
    }
  }
}
/** Guard output roots and existing output leaves before any writer opens them. */
export function assertRecordingOutput(root, output, leaves = []) {
  const source = resolve(root)
  const ancestorLogs = source.indexOf(`${sep}logs${sep}`)
  const logs = ancestorLogs === -1 ? join(source, 'logs') : source.slice(0, ancestorLogs + 5)
  const destination = resolve(output)
  requireValue(
    destination.startsWith(`${logs}${sep}`),
    'Recording output must stay inside project logs'
  )
  assertPhysicalDirectoryRoot(destination)
  for (const leaf of leaves) {
    requireValue(
      typeof leaf === 'string' &&
        leaf.length > 0 &&
        !leaf.includes('\\') &&
        leaf.split('/').every((part) => part && part !== '.' && part !== '..'),
      'Invalid recording output leaf'
    )
    assertSafeParents(destination, leaf)
    try {
      requireValue(
        !lstatSync(join(destination, leaf)).isSymbolicLink(),
        `Recording output leaf must not be a symlink: ${leaf}`
      )
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
  }
}
export function exportRecordingSources(cwd, projection, output) {
  validateProjection(projection)
  exportEntries(cwd, projection.entries, output)
  assertRecordingFixture(resolve(output), projection)
}
function exportEntries(cwd, entries, output) {
  const destination = resolve(output)
  assertPhysicalDirectoryRoot(cwd)
  assertPhysicalDirectoryRoot(destination)
  requireValue(
    destination.startsWith(`${resolve(cwd, 'logs')}${sep}`),
    'Raw fixture export must be inside repository logs'
  )
  const contents = blobBytes(
    cwd,
    entries.map((entry) => entry.blob)
  )
  for (const entry of entries) {
    assertSafeParents(destination, entry.path)
    requireValue(
      entry.mode !== '120000',
      `Recording raw fixtures do not permit guarded source symlinks: ${entry.path}`
    )
    const file = join(destination, entry.path)
    requireValue(!existsSync(file), `Raw fixture export refuses an existing path: ${entry.path}`)
    if (process.platform === 'win32' && entry.mode !== '100644') {
      throw new Error(`Exact ${entry.mode} export requires a POSIX runner: ${entry.path}`)
    }
    const bytes = contents.get(entry.blob)
    mkdirSync(dirname(file), { recursive: true })

    writeFileSync(file, bytes, { flag: 'wx' })
    if (entry.mode === '100755') {
      chmodSync(file, 0o755)
    }
  }
}
export function assertRecordingFixture(root, projection) {
  assertPhysicalDirectoryRoot(root)
  validateProjection(projection)
  const actual = []
  function walk(relative, recursive = true) {
    const directory = join(root, relative)
    if (!existsSync(directory)) {
      return
    }
    requireValue(!lstatSync(directory).isSymbolicLink(), `Escaping source directory: ${relative}`)
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const child = `${relative}/${item.name}`
      if (item.isDirectory() && recursive) {
        walk(child)
      } else if (guardedPath(child)) {
        actual.push(child)
      }
    }
  }
  walk('mobile/src')
  walk('src/shared')
  walk(FOUNDATION, false)
  walk('mobile/scripts', false)
  if (existsSync(join(root, 'mobile/pnpm-lock.yaml'))) {
    actual.push('mobile/pnpm-lock.yaml')
  }
  actual.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  requireValue(
    JSON.stringify(actual) === JSON.stringify(projection.entries.map((entry) => entry.path)),
    'Raw recording fixture paths differ from frozen projection'
  )
  assertEntries(root, projection.entries)
}
function assertEntries(root, entries) {
  for (const entry of entries) {
    assertSafeParents(root, entry.path)
    requireValue(
      entry.mode !== '120000',
      `Recording raw fixtures do not permit guarded source symlinks: ${entry.path}`
    )
    const file = join(root, entry.path)
    const stat = lstatSync(file)
    const mode = stat.isSymbolicLink()
      ? '120000'
      : stat.isFile()
        ? stat.mode & 0o111
          ? '100755'
          : '100644'
        : 'unsupported'
    if (process.platform === 'win32' && entry.mode !== '100644') {
      throw new Error(`Exact ${entry.mode} verification requires a POSIX runner: ${entry.path}`)
    }
    requireValue(mode === entry.mode, `Raw recording fixture mode differs: ${entry.path}`)
    const bytes = readFileSync(file)
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    requireValue(blob === entry.blob, `Raw recording fixture bytes differ: ${entry.path}`)
  }
}

/** Discover only static relative ESM dependencies from the published control object. */
export function recordingControlProjection(cwd, controlSha) {
  const entries = treeEntries(cwd, controlSha)
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  const contents = blobBytes(
    cwd,
    entries
      .filter(
        (entry) =>
          entry.type === 'blob' &&
          entry.path.startsWith('config/scripts/') &&
          entry.path.endsWith('.mjs')
      )
      .map((entry) => entry.blob)
  )
  const visited = new Map()
  function visit(path) {
    if (visited.has(path)) {
      return
    }
    const entry = byPath.get(path)
    requireValue(
      entry && entry.type === 'blob' && entry.mode === '100644',
      `Missing or non-regular recording control: ${path}`
    )
    const text = contents.get(entry.blob).toString('utf8')
    visited.set(path, { path, mode: entry.mode, blob: entry.blob })
    // These published modules are dependency-free ESM; dynamic loading is not permitted.
    requireValue(
      !/\b(?:import|require)\s*\(/.test(text),
      `Dynamic recording control dependency: ${path}`
    )
    const specs = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )
    for (const spec of specs) {
      if (spec.startsWith('node:')) {
        continue
      }
      requireValue(
        spec.startsWith('./') && spec.endsWith('.mjs'),
        `Unsupported recording control dependency: ${path}: ${spec}`
      )
      const dependency = posix.normalize(posix.join(posix.dirname(path), spec))
      requireValue(
        dependency.startsWith('config/scripts/'),
        'Recording control dependency escapes config/scripts'
      )
      visit(dependency)
    }
  }
  visit('config/scripts/upstream-recording-source.mjs')
  const selected = [...visited.values()].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))
  )
  return {
    controlSourcesSha256: controlDigest(selected),
    controlFileCount: selected.length,
    entries: selected
  }
}
function controlDigest(entries) {
  return sha256(
    `hive-recording-controls-v1\0${entries
      .map(({ path, mode, blob }) => `${path}\0${mode}\0${blob}\0`)
      .join('')}`
  )
}
function validatedControls(cwd, controlSha, projection) {
  const expected = recordingControlProjection(cwd, controlSha)
  requireValue(
    JSON.stringify(projection) === JSON.stringify(expected),
    'Recording control projection differs from published M objects'
  )
  return expected
}
export function exportRecordingControls(cwd, controlSha, projection, output) {
  const expected = validatedControls(cwd, controlSha, projection)
  exportEntries(cwd, expected.entries, output)
  assertRecordingControls(output, controlSha, projection, cwd)
}
export function assertRecordingControls(root, controlSha, projection, objectRepository = root) {
  assertPhysicalDirectoryRoot(root)
  const expected = validatedControls(objectRepository, controlSha, projection)
  assertEntries(root, expected.entries)
}
