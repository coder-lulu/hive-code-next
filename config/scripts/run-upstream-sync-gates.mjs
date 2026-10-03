import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const MANIFEST_PATH = path.join(REPO_ROOT, 'config', 'upstream-sync-gates.json')
const MATRIX_PATH = path.join(REPO_ROOT, 'config', 'upstream-regression-matrix.json')

function loadManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.suites) {
    throw new Error('upstream-sync-gates.json must use schemaVersion 1 and define suites')
  }
  return manifest
}

function parseOptions(argv) {
  let suite = 'common'
  let platform = process.platform
  let list = false
  let cwd = REPO_ROOT
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--cwd') {
      if (!argv[index + 1]) {
        throw new Error('--cwd requires a checkout path')
      }
      cwd = path.resolve(argv[++index])
      continue
    }
    if (argument === '--list') {
      list = true
      continue
    }
    if (argument === '--suite') {
      suite = argv[++index]
      continue
    }
    if (argument.startsWith('--suite=')) {
      suite = argument.slice('--suite='.length)
      continue
    }
    if (argument === '--platform') {
      platform = argv[++index]
      continue
    }
    if (argument.startsWith('--platform=')) {
      platform = argument.slice('--platform='.length)
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return { suite, list, platform, cwd }
}

export function selectChecks({ manifest, matrix, suite = 'common', platform = process.platform }) {
  const suiteNames = suite === 'all' ? ['common'] : suite === 'regression' ? [] : [suite]
  let extraChecks = []
  if (suite === 'all' || suite === 'regression') {
    const platformName = { win32: 'windows', darwin: 'macos', linux: 'linux' }[platform]
    const coverage = matrix?.platforms?.[platformName]
    if (
      matrix?.schemaVersion !== 2 ||
      !coverage ||
      !Array.isArray(coverage.suites) ||
      coverage.suites.length === 0 ||
      !Array.isArray(coverage.checks)
    ) {
      throw new Error(`No valid upstream regression coverage for ${platform}`)
    }
    suiteNames.push(...coverage.suites)
    extraChecks = coverage.checks
  }
  const checks = suiteNames
    .flatMap((name) => {
      if (!Array.isArray(manifest.suites[name])) {
        throw new Error(`Unknown upstream sync gate suite: ${name}`)
      }
      return manifest.suites[name]
    })
    .concat(extraChecks)
  const selected = new Map()
  for (const check of checks) {
    const existing = selected.get(check.id)
    if (existing && JSON.stringify(existing) !== JSON.stringify(check)) {
      throw new Error(`Conflicting upstream sync gate definitions: ${check.id}`)
    }
    selected.set(check.id, check)
  }
  return [...selected.values()]
}

function isUnsafeRelativePath(value) {
  return (
    typeof value !== 'string' ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.split(/[\\/]/).includes('..')
  )
}

function validateCheck(check, suiteName, index, repoRoot) {
  if (!check || typeof check !== 'object' || typeof check.id !== 'string') {
    throw new Error(`Invalid check at ${suiteName}[${index}]`)
  }
  if (!['command', 'vitest'].includes(check.kind)) {
    throw new Error(`Unsupported check kind for ${check.id}: ${check.kind}`)
  }
  if (!Array.isArray(check.argv) || check.argv.length === 0) {
    throw new Error(`${check.id} must define a non-empty argv array`)
  }
  if (check.argv.some((argument) => typeof argument !== 'string')) {
    throw new Error(`${check.id} argv entries must be strings`)
  }
  if (isUnsafeRelativePath(check.cwd)) {
    throw new Error(`${check.id} has an unsafe cwd: ${check.cwd}`)
  }
  if (typeof check.argv[0] !== 'string' || check.argv[0].length === 0) {
    throw new Error(`${check.id} must start argv with an executable name`)
  }
  if (check.kind === 'vitest') {
    if (!Array.isArray(check.paths) || check.paths.length === 0) {
      throw new Error(`${check.id} must define test paths`)
    }
    for (const testPath of check.paths) {
      if (isUnsafeRelativePath(testPath) || !existsSync(path.join(repoRoot, check.cwd, testPath))) {
        throw new Error(`${check.id} references a missing or unsafe test path: ${testPath}`)
      }
    }
  }
}

function resolveInvocation(command, args) {
  if (process.platform === 'win32' && command === 'pnpm') {
    const commandLine = ['pnpm', ...args]
      .map((value) => (/[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value))
      .join(' ')
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine]
    }
  }
  return { command, args }
}

function runCheck(check, repoRoot) {
  const cwd = path.resolve(repoRoot, check.cwd)
  const rawArgs = [...check.argv.slice(1), ...(check.paths ?? [])]
  const invocation = resolveInvocation(check.argv[0], rawArgs)
  const { command, args } = invocation
  console.log(`\n[upstream-sync] ${check.category}: ${check.id}`)
  console.log(`> ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) {
    console.error(`[upstream-sync] ${check.id} failed to start: ${result.error.message}`)
    return false
  }
  if (result.status !== 0) {
    console.error(`[upstream-sync] ${check.id} failed with exit code ${result.status ?? 'unknown'}`)
    return false
  }
  return true
}

function main() {
  const { suite, list, platform, cwd } = parseOptions(process.argv.slice(2))
  const manifest = loadManifest()
  const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'))
  const checks = selectChecks({ manifest, matrix, suite, platform })
  checks.forEach((check, index) => validateCheck(check, suite, index, cwd))
  if (list) {
    console.log(`${suite} (${platform}):`)
    for (const check of checks) {
      console.log(`- ${check.id} (${check.category})`)
    }
    return
  }
  if (platform !== process.platform) {
    throw new Error(
      'Cross-platform selection is available for --list only; execute on the actual OS'
    )
  }
  let failed = 0
  for (const check of checks) {
    if (!runCheck(check, cwd)) {
      failed += 1
    }
  }
  if (failed > 0) {
    throw new Error(`${failed} fixed gate(s) failed.`)
  }
  console.log(`\n[upstream-sync] ${checks.length} fixed gate(s) passed on ${process.platform}.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (error) {
    console.error(`[upstream-sync] ${error.message}`)
    process.exitCode = 1
  }
}
