import { readFileSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DOCS_ONLY_FILES = new Set([
  'README.md',
  'LICENSE',
  'AGENTS.md',
  'CLAUDE.md',
  'Agents.md',
  'Claude.md',
  '.github/CONTRIBUTING.md',
  '.github/pull_request_template.md',
  '.github/CODEOWNERS'
])

const DOCS_ONLY_PREFIXES = ['docs/', '.github/ISSUE_TEMPLATE/']

const NATIVE_CACHE_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  '.github/actions/install-node-dependencies/action.yml',
  'config/scripts/ensure-native-runtime.mjs',
  'config/scripts/rebuild-native-deps.mjs'
])

const NATIVE_CACHE_PREFIXES = [
  'config/patches/node-pty@',
  'config/patches/@vscode__windows-process-tree'
]

export function isDocsOnlyPath(file) {
  if (DOCS_ONLY_FILES.has(file)) {
    return true
  }
  if (DOCS_ONLY_PREFIXES.some((prefix) => file.startsWith(prefix))) {
    return true
  }
  return /^README\.[^/]+\.md$/.test(file)
}

export function shouldRunPrChecks(changedFiles) {
  // Why empty-run: a silent empty diff is more likely a detector bug than a
  // genuine no-op PR, so fail closed and keep the expensive jobs.
  if (changedFiles.length === 0) {
    return true
  }
  return changedFiles.some((file) => !isDocsOnlyPath(file))
}

export function hasNativeCacheInput(changedFiles) {
  // An empty diff indicates detector uncertainty; fail closed and prime once.
  if (changedFiles.length === 0) {
    return true
  }
  return changedFiles.some(
    (file) =>
      NATIVE_CACHE_FILES.has(file) ||
      NATIVE_CACHE_PREFIXES.some((prefix) => file.startsWith(prefix))
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = readFileSync(0, 'utf8').split('\n').filter(Boolean)
  const result = process.argv.includes('--native-cache')
    ? hasNativeCacheInput(files)
    : shouldRunPrChecks(files)
  process.stdout.write(result ? 'true\n' : 'false\n')
}
