import { spawn, spawnSync } from 'node:child_process'
import { resolvePnpmCliInvocation } from './pnpm-cli-invocation.mjs'
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
  lstatSync
} from 'node:fs'
import path from 'node:path'
import {
  discoverChangedPaths,
  planRepairChecks,
  validateBase
} from './upstream-sync-repair-plan.mjs'

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

export function parseOptions(argv) {
  let phase = 'final'
  let changedFrom
  let report
  let explicitSuite = false
  let suite = 'common'
  let platform = process.platform
  let list = false
  let cwd = REPO_ROOT
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const option = ['phase', 'changed-from', 'report'].find(
      (name) => argument === `--${name}` || argument.startsWith(`--${name}=`)
    )
    if (option) {
      const value = argument.includes('=')
        ? argument.slice(argument.indexOf('=') + 1)
        : argv[++index]
      if (!value || value.startsWith('--')) {
        throw new Error(`--${option} requires a value`)
      }
      if (option === 'phase') {
        phase = value
      }
      if (option === 'changed-from') {
        changedFrom = value
      }
      if (option === 'report') {
        report = value
      }
      continue
    }
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
      explicitSuite = true
      suite = argv[++index]
      continue
    }
    if (argument.startsWith('--suite=')) {
      explicitSuite = true
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
  if (!['repair', 'final'].includes(phase)) {
    throw new Error('Unknown verification phase')
  }
  if (phase === 'final' && changedFrom !== undefined) {
    throw new Error('--changed-from is only allowed in repair phase')
  }
  if (phase === 'repair') {
    if (!changedFrom) {
      throw new Error('repair requires --changed-from')
    }
    validateBase(changedFrom)
    if (explicitSuite) {
      throw new Error('repair selects from all fixed gates; --suite is not allowed')
    }
    suite = 'all'
  }
  return { suite, list, platform, cwd, phase, changedFrom, report }
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

export function gateInvocation(command, args) {
  if (command !== 'pnpm') {
    return { command, args }
  }
  const invocation = resolvePnpmCliInvocation()
  if (!invocation.shell) {
    return { command: invocation.command, args: [...invocation.prefixArgs, ...args] }
  }
  const directories = [
    path.dirname(process.execPath),
    ...(process.env.PATH ?? '').split(path.delimiter)
  ].filter((directory) => path.isAbsolute(directory))
  for (const directory of directories) {
    const native = path.join(directory, 'pnpm.exe')
    if (existsSync(native)) {
      return { command: native, args }
    }
    for (const relative of [
      'node_modules/corepack/dist/pnpm.js',
      'node_modules/pnpm/bin/pnpm.cjs'
    ]) {
      const cli = path.join(directory, relative)
      if (existsSync(cli)) {
        return { command: process.execPath, args: [cli, ...args] }
      }
    }
  }
  throw new Error(
    'No shell-free pnpm entry found; set npm_execpath to the pinned pnpm JS CLI or executable'
  )
}

export async function runCheck(check, repoRoot) {
  console.log(`\n[upstream-sync] ${check.category}: ${check.id}`)
  const invocation = gateInvocation(check.argv[0], [...check.argv.slice(1), ...(check.paths ?? [])])
  const child = spawn(invocation.command, invocation.args, {
    cwd: path.resolve(repoRoot, check.cwd),
    env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  return await new Promise((resolve) => {
    child.on('error', (error) => {
      console.error(error.message)
      resolve(false)
    })
    child.on('close', (code) => resolve(code === 0))
  })
}

export function discoverCheckoutChanges(base, cwd) {
  return discoverChangedPaths(base, (args) => {
    const result = spawnSync('git', args, {
      cwd,
      windowsHide: true,
      shell: false,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
    if (result.error) {
      throw result.error
    }
    if (result.status !== 0) {
      throw new Error(`Changed-file discovery failed: ${result.stderr}`)
    }
    return result.stdout
  })
}

export function reportPath(repoRoot, requested) {
  if (!requested) {
    return undefined
  }
  const destination = path.resolve(repoRoot, requested)
  if (/^(?:common-gates|regression)(?:[.-]|$)/i.test(path.basename(destination))) {
    throw new Error('Diagnostic report cannot use an official acceptance filename')
  }
  const logs = path.resolve(repoRoot, 'logs')
  if (!destination.startsWith(logs + path.sep) || destination === logs) {
    throw new Error('--report must be under checkout logs/')
  }
  let current = logs
  const parts = path.relative(logs, destination).split(path.sep)
  for (let index = 0; index <= parts.length; index += 1) {
    const entry = lstatSync(current, { throwIfNoEntry: false })
    if (entry?.isSymbolicLink()) {
      throw new Error('Report path cannot contain a symlink or junction')
    }
    if (index === parts.length && entry) {
      throw new Error('Report already exists; preserve previous evidence')
    }
    if (index < parts.length) {
      current = path.join(current, parts[index])
    }
  }
  mkdirSync(path.dirname(destination), { recursive: true })
  const realLogs = realpathSync(logs)
  const realParent = realpathSync(path.dirname(destination))
  if (realParent !== realLogs && !realParent.startsWith(realLogs + path.sep)) {
    throw new Error('Report parent escapes logs/')
  }
  return destination
}

async function main() {
  const { suite, list, platform, cwd, phase, changedFrom, report } = parseOptions(
    process.argv.slice(2)
  )
  const manifest = loadManifest()
  const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'))
  const fixedChecks = selectChecks({ manifest, matrix, suite, platform })
  let plan = { checks: fixedChecks, omittedGates: [] }
  if (phase === 'repair') {
    plan = planRepairChecks(fixedChecks, discoverCheckoutChanges(changedFrom, cwd), (file) =>
      existsSync(path.join(cwd, file))
    )
  }
  const checks = plan.checks
  const destination = reportPath(cwd, report)
  const results = []
  const writeReport = () => {
    if (destination) {
      writeFileSync(
        destination,
        `${JSON.stringify(
          {
            schema: 'upstream-sync-gate-diagnostic/v1',
            phase,
            formalAcceptance: false,
            suite,
            platform,
            changedFrom,
            changedPaths: plan.changedPaths ?? [],
            fallbackPaths: plan.fallbackPaths ?? [],
            omittedGates: plan.omittedGates,
            plannedGates: checks.map((check) => check.id),
            results,
            listOnly: list
          },
          null,
          2
        )}\n`
      )
    }
  }
  checks.forEach((check, index) => validateCheck(check, suite, index, cwd))
  if (list) {
    console.log(`${suite} (${platform}):`)
    for (const check of checks) {
      console.log(`- ${check.id} (${check.category})`)
    }
    writeReport()
    return
  }
  if (platform !== process.platform) {
    throw new Error(
      'Cross-platform selection is available for --list only; execute on the actual OS'
    )
  }
  let failed = 0
  for (const check of checks) {
    let passed = false
    try {
      passed = await runCheck(check, cwd)
    } catch (error) {
      console.error(error.message)
    }
    results.push({ id: check.id, status: passed ? 'passed' : 'failed' })
    if (!passed) {
      failed += 1
    }
    writeReport()
  }
  if (failed > 0) {
    throw new Error(`${failed} fixed gate(s) failed.`)
  }
  console.log(`\n[upstream-sync] ${checks.length} fixed gate(s) passed on ${process.platform}.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    await main()
  } catch (error) {
    console.error(`[upstream-sync] ${error.message}`)
    process.exitCode = 1
  }
}
