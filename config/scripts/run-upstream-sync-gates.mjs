import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const MANIFEST_PATH = path.join(REPO_ROOT, 'config', 'upstream-sync-gates.json')

function loadManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.suites) {
    throw new Error('upstream-sync-gates.json must use schemaVersion 1 and define suites')
  }
  return manifest
}

function parseOptions(argv) {
  let suite = 'common'
  let list = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
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
    throw new Error(`Unknown argument: ${argument}`)
  }
  return { suite, list }
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

function validateCheck(check, suiteName, index) {
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
      if (
        isUnsafeRelativePath(testPath) ||
        !existsSync(path.join(REPO_ROOT, check.cwd, testPath))
      ) {
        throw new Error(`${check.id} references a missing or unsafe test path: ${testPath}`)
      }
    }
  }
}

function resolveInvocation(command, args) {
  if (process.platform === 'win32' && command === 'pnpm') {
    const commandLine = ['pnpm.cmd', ...args]
      .map((value) => (/[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value))
      .join(' ')
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine]
    }
  }
  return { command, args }
}

function runCheck(check) {
  const cwd = path.resolve(REPO_ROOT, check.cwd)
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

const { suite, list } = parseOptions(process.argv.slice(2))
const manifest = loadManifest()
const suiteNames = suite === 'all' ? Object.keys(manifest.suites) : [suite]
for (const suiteName of suiteNames) {
  if (!Array.isArray(manifest.suites[suiteName])) {
    throw new Error(`Unknown upstream sync gate suite: ${suiteName}`)
  }
}

if (list) {
  for (const suiteName of suiteNames) {
    console.log(`${suiteName}:`)
    for (const check of manifest.suites[suiteName]) {
      console.log(`- ${check.id} (${check.category})`)
    }
  }
  process.exit(0)
}

const checks = suiteNames.flatMap((suiteName) => {
  const suiteChecks = manifest.suites[suiteName]
  suiteChecks.forEach((check, index) => validateCheck(check, suiteName, index))
  return suiteChecks
})

let failed = 0
for (const check of checks) {
  if (!runCheck(check)) {
    failed += 1
  }
}

if (failed > 0) {
  console.error(`\n[upstream-sync] ${failed} fixed gate(s) failed.`)
  process.exit(1)
}
console.log(`\n[upstream-sync] ${checks.length} fixed gate(s) passed on ${process.platform}.`)
