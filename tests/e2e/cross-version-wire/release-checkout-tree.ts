import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { list as listTar } from 'tar'
import type * as ProcessRunner from '../../../src/shared/child-process/run-process'
import {
  collectPackageImports,
  installMissingPackageStandIns,
  type PackageImports
} from './release-missing-packages.ts'

const CHECKOUT_PROCESS_TIMEOUT_MS = 45_000
const CHECKOUT_MAX_OUTPUT_BYTES = 1024 * 1024
const CHECKOUT_SOURCE_WORKERS = 8
let processRunner: Promise<typeof ProcessRunner> | undefined

// Why: the wire endpoints only need the runtime RPC host, the renderer client, and
// the shared codec, plus the relay an app update leaves running. Skipping cli keeps a cold CI
// extraction a few seconds.
// The phone's `worktree ps` row reader is one self-contained file, so it rides along alone.
const ARCHIVE_PATHS = [
  'src/main',
  'src/shared',
  'src/preload',
  'src/relay',
  'src/renderer',
  'src/types',
  'mobile/src/worktree/agent-row-display.ts'
]
// Product-owned policy inputs exist only in newer trees; released Orca trees need none of them.
const OPTIONAL_ARCHIVE_PATHS = [
  'integration/paperclip/runtime/codex-package.json',
  'integration/paperclip/runtime/catalog-provenance.json',
  'integration/paperclip/runtime/model-tools.json',
  'integration/paperclip/runtime/hive-models.json'
]
// The tree preparation removes these too; avoid archiving and extracting discarded tests.
const TEST_SOURCE_SUFFIXES = ['test', 'bench', 'spec'].flatMap((kind) =>
  ['ts', 'tsx'].map((extension) => `.${kind}.${extension}`)
)
const ARCHIVE_TEST_EXCLUDES = TEST_SOURCE_SUFFIXES.map((suffix) => `:(glob,exclude)**/*${suffix}`)
const TAR_TEST_EXCLUDES = TEST_SOURCE_SUFFIXES.map((suffix) => `--exclude=*${suffix}`)

const ALIAS_SPECIFIER =
  /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])@(renderer)?\/([^'"]+)\2/g

function isRewritableSource(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.tsx')
}

function isTestSource(name: string): boolean {
  return /\.(test|bench|spec)\.(ts|tsx)$/.test(name)
}

/** Keep renderer aliases inside the extracted release rather than the working tree. */
async function rewriteRendererAliases(
  file: string,
  source: string,
  rendererRoot: string
): Promise<string> {
  if (!source.includes("'@/") && !source.includes('"@/') && !source.includes('@renderer/')) {
    return source
  }
  const rewritten = source.replace(
    ALIAS_SPECIFIER,
    (_match, keyword: string, quote: string, _renderer: string | undefined, target: string) => {
      const absolute = join(rendererRoot, target)
      let relativePath = relative(dirname(file), absolute).split('\\').join('/')
      if (!relativePath.startsWith('.')) {
        relativePath = `./${relativePath}`
      }
      return `${keyword}${quote}${relativePath}${quote}`
    }
  )
  if (rewritten !== source) {
    await writeFile(file, rewritten)
  }
  return rewritten
}

async function prepareExtractedTree(root: string, packageImports: PackageImports): Promise<void> {
  const rendererRoot = join(root, 'src', 'renderer', 'src')
  const files: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      if (isTestSource(entry.name)) {
        await rm(full)
        continue
      }
      if (entry.isFile()) {
        files.push(full)
      }
    }
  }
  await walk(join(root, 'src'))
  let nextFile = 0
  let failed = false
  let failure: unknown
  const prepare = async (): Promise<void> => {
    while (!failed) {
      const full = files[nextFile++]
      if (full === undefined) {
        return
      }
      try {
        // Why: stale specs must not enter repo-wide tool walks through the cache.
        if (isTestSource(full)) {
          await rm(full)
        } else if (isRewritableSource(full)) {
          const source = await readFile(full, 'utf8')
          const rewritten = await rewriteRendererAliases(full, source, rendererRoot)
          collectPackageImports(rewritten, packageImports)
        }
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
    }
  }
  // Settle issued writes before the materializer removes staging or releases its lock.
  await Promise.all(Array.from({ length: CHECKOUT_SOURCE_WORKERS }, prepare))
  if (failed) {
    throw failure
  }
}

function checkoutTarProgram(): string {
  if (process.platform !== 'win32') {
    return 'tar'
  }
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
  return join(systemRoot, 'System32', 'tar.exe')
}

async function runCheckoutProcess(
  repoRoot: string,
  program: string,
  args: string[],
  deadline: number
): Promise<string> {
  // Kept lazy so plain Node 24 contention children never load Vite's TS graph.
  const { runProcess } = await (processRunner ??=
    import('../../../src/shared/child-process/run-process'))
  const result = await runProcess({
    program,
    args,
    cwd: repoRoot,
    timeoutMs: Math.max(1, deadline - Date.now()),
    maxOutputBytes: CHECKOUT_MAX_OUTPUT_BYTES,
    terminationBarrier: true
  })
  if (result.code === 0 && !result.timedOut) {
    return result.stdout
  }
  const detail = result.timedOut
    ? `timed out after ${CHECKOUT_PROCESS_TIMEOUT_MS}ms`
    : result.stderr.trim() || `exited with ${result.code}`
  throw new Error(`${program} ${args[0] ?? ''} ${detail}`)
}

async function extractWindowsCheckout(
  repoRoot: string,
  staging: string,
  archive: string,
  deadline: number
): Promise<void> {
  const paths: string[][] = Array.from({ length: CHECKOUT_SOURCE_WORKERS }, () => [])
  await listTar({
    file: archive,
    strict: true,
    onReadEntry: (entry) => {
      if (['File', 'SymbolicLink', 'Link'].includes(entry.type)) {
        const bucket = createHash('sha1').update(entry.path).digest()[0] % paths.length
        paths[bucket].push(entry.path)
      }
    }
  })
  const manifests = paths.map((_, index) => join(staging, `.checkout-paths-${index}.txt`))
  try {
    const writes = await Promise.allSettled(
      paths.map((part, index) => writeFile(manifests[index], part.join('\n')))
    )
    for (const result of writes) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
    // Windows metadata writes dominate a serial extraction; each member has one owner.
    const results = await Promise.allSettled(
      paths.map((part, index) =>
        part.length === 0
          ? Promise.resolve()
          : runCheckoutProcess(
              repoRoot,
              checkoutTarProgram(),
              [...TAR_TEST_EXCLUDES, '-xf', archive, '-C', staging, '-T', manifests[index]],
              deadline
            )
      )
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
  } finally {
    await Promise.all(manifests.map((manifest) => rm(manifest, { force: true })))
  }
}

export async function extractReleaseCheckoutTree(
  repoRoot: string,
  staging: string,
  commit: string,
  archivePaths: readonly string[] = ARCHIVE_PATHS,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const archive = join(staging, '.release-checkout.tar')
  const deadline = Date.now() + CHECKOUT_PROCESS_TIMEOUT_MS
  try {
    const tracked =
      archivePaths === ARCHIVE_PATHS
        ? new Set(
            (
              await runCheckoutProcess(
                repoRoot,
                'git',
                ['ls-tree', '--name-only', commit, '--', ...OPTIONAL_ARCHIVE_PATHS],
                deadline
              )
            )
              .trim()
              .split('\n')
          )
        : new Set<string>()
    const paths = [...archivePaths, ...OPTIONAL_ARCHIVE_PATHS.filter((path) => tracked.has(path))]
    await runCheckoutProcess(
      repoRoot,
      'git',
      [
        'archive',
        '--format=tar',
        `--output=${archive}`,
        commit,
        '--',
        ...paths,
        ...ARCHIVE_TEST_EXCLUDES
      ],
      deadline
    )
    await (platform === 'win32'
      ? extractWindowsCheckout(repoRoot, staging, archive, deadline)
      : runCheckoutProcess(
          repoRoot,
          checkoutTarProgram(),
          [...TAR_TEST_EXCLUDES, '-xf', archive, '-C', staging],
          deadline
        ))
  } finally {
    await rm(archive, { force: true })
  }
  const packageImports: PackageImports = new Map()
  await prepareExtractedTree(staging, packageImports)
  if (packageImports.size > 0) {
    await installMissingPackageStandIns(
      staging,
      commit,
      packageImports,
      JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
    )
  }
}

export async function scavengeReleaseCheckoutStaging(
  directory: string,
  prefix: string
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(prefix)) {
      await rm(join(directory, entry.name), { recursive: true, force: true })
    }
  }
}
