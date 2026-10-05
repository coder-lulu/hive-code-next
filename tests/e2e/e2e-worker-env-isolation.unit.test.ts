import { readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One Playwright worker imports many spec files into one Node process, and the app fixtures
 * launch Electron with a spread of that process's `process.env`. A module-scope write therefore
 * reconfigures every app launched by every spec that follows in the same worker — and it runs at
 * import time, before any hook or `finally` exists that could undo it, so unlike a write inside a
 * test body it cannot be restored at all.
 *
 * That is not a hypothetical: a parking-delay override written this way shrank the terminal
 * cold-park delay from 30s to 2s for later specs, which unmounted panes those specs still needed.
 * Use `test.use({ orcaAppExtraEnv })`, which Playwright scopes to the file.
 */
const E2E_ROOT = resolve(__dirname)

/**
 * Module scope is read off column 0. The tree is prettier-formatted, so every statement nested in
 * a function, hook, block, or `app.evaluate` callback is indented — including the in-body writes
 * that legitimately save and restore around a relaunch. A write that starts a line is top-level.
 */
const MODULE_SCOPE_ENV_WRITE =
  /^(?:process\.env\.[A-Za-z_][A-Za-z0-9_]*\s*(?:\??\|\||\?\?|)=[^=]|process\.env\[|delete\s+process\.env[.[]|Object\.assign\(\s*process\.env)/

// No file may write at module scope. The replacement is a fixture option, which reaches the app
// launch without touching the worker every other spec shares.
const SCANNED_EXTENSIONS = ['.ts', '.tsx']
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  '__fixtures__',
  '.cross-version-checkouts'
])

function collectE2eFiles(
  root: string,
  legacyCheckoutRoot = join(E2E_ROOT, '.cross-version-checkouts')
): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root)) {
    if (IGNORED_DIRECTORIES.has(entry)) {
      continue
    }
    const path = join(root, entry)
    // This exact ignored legacy cache holds old application source, not worker specs.
    if (path === legacyCheckoutRoot) {
      continue
    }
    if (statSync(path).isDirectory()) {
      found.push(...collectE2eFiles(path, legacyCheckoutRoot))
    } else if (SCANNED_EXTENSIONS.some((extension) => path.endsWith(extension))) {
      found.push(path)
    }
  }
  return found
}

function findModuleScopeEnvWrites(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      MODULE_SCOPE_ENV_WRITE.test(line)
        ? [`${relative(E2E_ROOT, path)}:${index + 1}: ${line.trim()}`]
        : []
    )
}

describe('e2e worker env isolation', () => {
  const offenders = collectE2eFiles(E2E_ROOT).flatMap(findModuleScopeEnvWrites)

  it('no e2e file writes process.env at module scope', () => {
    expect(offenders).toEqual([])
  })

  it('excludes only the known legacy checkout while checking active and nested same-name trees', async () => {
    const scratchRoot = resolve(E2E_ROOT, '..', '..', 'logs', 'e2e-worker-env-isolation')
    await mkdir(scratchRoot, { recursive: true })
    const scratch = await mkdtemp(join(scratchRoot, 'scope-'))
    try {
      const legacyCheckoutRoot = join(scratch, '.cross-version-checkouts')
      const nestedRoot = join(scratch, 'current', '.cross-version-checkouts')
      await mkdir(join(legacyCheckoutRoot, 'src', 'main'), { recursive: true })
      await mkdir(nestedRoot, { recursive: true })
      const active = join(scratch, 'active.spec.ts')
      const nested = join(nestedRoot, 'active.spec.ts')
      const legacy = join(legacyCheckoutRoot, 'src', 'main', 'index.ts')
      const write = "process.env.ORCA_E2E_FIXTURE = '1'"
      await Promise.all([active, nested, legacy].map((path) => writeFile(path, `${write}\n`)))
      const files = collectE2eFiles(scratch, legacyCheckoutRoot).sort()
      expect(files).toEqual([active, nested].sort())
      expect(files.flatMap(findModuleScopeEnvWrites).sort()).toEqual(
        [active, nested].map((path) => `${relative(E2E_ROOT, path)}:1: ${write}`).sort()
      )
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  })

  it('detects the shape it is meant to catch', () => {
    // Guards the regex itself: a green that cannot go red would pass this whole file forever.
    expect(MODULE_SCOPE_ENV_WRITE.test("process.env.ORCA_E2E_X ??= '1'")).toBe(true)
    expect(MODULE_SCOPE_ENV_WRITE.test("process.env.ORCA_E2E_X = '1'")).toBe(true)
    expect(MODULE_SCOPE_ENV_WRITE.test('delete process.env.ORCA_E2E_X')).toBe(true)
    expect(MODULE_SCOPE_ENV_WRITE.test("Object.assign(process.env, { ORCA_E2E_X: '1' })")).toBe(
      true
    )
    // Reads, and writes nested in any body, stay legal.
    expect(MODULE_SCOPE_ENV_WRITE.test('const x = Number(process.env.ORCA_E2E_X) || 500')).toBe(
      false
    )
    expect(MODULE_SCOPE_ENV_WRITE.test("  process.env.ORCA_E2E_X = '1'")).toBe(false)
    expect(MODULE_SCOPE_ENV_WRITE.test("if (process.env.ORCA_E2E_X === '1') {")).toBe(false)
  })
})
