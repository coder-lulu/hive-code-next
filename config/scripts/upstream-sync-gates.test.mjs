import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  selectChecks,
  runCheck,
  resolveGateInvocation,
  buildGateInvocations,
  gateCommandLineLength,
  GATE_COMMAND_LINE_BUDGET
} from './run-upstream-sync-gates.mjs'

vi.mock('node:child_process', async (original) => ({
  ...(await original()),
  spawn: vi.fn()
}))

const projectDir = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(
  readFileSync(join(projectDir, 'config/upstream-sync-gates.json'), 'utf8')
)
const workflow = readFileSync(join(projectDir, '.github/workflows/upstream-sync.yml'), 'utf8')
const matrix = JSON.parse(
  readFileSync(join(projectDir, 'config/upstream-regression-matrix.json'), 'utf8')
)

describe('upstream synchronization fixed gates', () => {
  it('keeps the required product-boundary categories explicit', () => {
    const checks = Object.values(manifest.suites).flat()
    expect(new Set(checks.map((check) => check.id)).size).toBe(checks.length)
    expect(new Set(checks.map((check) => check.category))).toEqual(
      new Set([
        'brand',
        'hivecloud',
        'updater',
        'mobile',
        'runtime-rpc',
        'recording-source',
        'platform',
        'generated',
        'lockfile'
      ])
    )
  })

  it('keeps every declared test path present in its working directory', () => {
    for (const checks of Object.values(manifest.suites)) {
      for (const check of checks) {
        for (const testPath of check.paths ?? []) {
          expect(
            existsSync(join(projectDir, check.cwd, testPath)),
            `${check.id}: ${testPath}`
          ).toBe(true)
        }
      }
    }
  })

  it('checks Git host ownership and managed SSH conversion at their current owners', () => {
    const paths = manifest.suites.platform.find((check) => check.id === 'pty-wsl-ssh').paths
    expect(paths).toEqual(
      expect.arrayContaining([
        'src/main/providers/local-git-provider.test.ts',
        'src/main/runtime/runtime-git-execution-host-ownership.test.ts',
        'src/main/runtime/runtime-git-stage-worktree-scope.test.ts',
        'src/main/ssh/orcad-runtime-conversion.test.ts',
        'src/main/ssh/orcad-migration-terminal-gate.test.ts'
      ])
    )
    expect(paths.some((path) => path.includes('/ssh-git-provider-'))).toBe(false)
  })

  it('runs common gates and a three-runner platform matrix before promotion', () => {
    expect(workflow).toContain('run-upstream-sync-gates.mjs" --suite=common')
    expect(workflow).toContain('run-upstream-sync-gates.mjs" --suite=regression')
    expect(workflow).toContain('ubuntu-latest')
    expect(workflow).toContain('windows-latest')
    expect(workflow).toContain('macos-latest')
    expect(workflow).toContain('platform-gates')
    expect(workflow).toContain("needs.platform-gates.result == 'success'")
  })

  it('retains control ancestors in every checkout so thin bundles cannot hide source provenance', () => {
    const depths = [...workflow.matchAll(/fetch-depth: (\d+)/g)].map((match) => Number(match[1]))
    expect(depths).toHaveLength(4)
    expect(depths).toEqual([0, 0, 0, 0])
  })

  it('keeps the frozen product review position separate from the tested candidate', () => {
    expect(workflow).toContain(
      'candidate_sha: ${{ steps.bundle_input.outputs.candidate_sha || steps.bundle.outputs.candidate_sha }}'
    )
    expect(workflow).toContain('track-upstream-changes.mjs')
    expect(workflow).toContain('--state-ref "$TARGET_SHA"')
    expect(workflow).toContain('--head "$UPSTREAM_SHA"')
    expect(workflow).toContain('upstream-change-intake.md')
  })

  it('executes the focused contracts on every OS and CLI checks on Windows without duplicates', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const checks = selectChecks({ manifest, matrix, suite: 'regression', platform })
      expect(checks.map((check) => check.id)).toEqual(
        platform === 'win32'
          ? ['pty-wsl-ssh', 'recording-source-platform', 'windows-cli-typecheck']
          : ['pty-wsl-ssh', 'recording-source-platform']
      )
      const all = selectChecks({ manifest, matrix, suite: 'all', platform })
      expect(all.filter((check) => check.id === 'pty-wsl-ssh')).toHaveLength(1)
      expect(all.filter((check) => check.id === 'recording-source-platform')).toHaveLength(1)
      expect(all.filter((check) => check.id === 'recording-source-common')).toHaveLength(1)
      for (const check of checks) {
        for (const testPath of check.paths ?? []) {
          expect(existsSync(join(projectDir, check.cwd, testPath))).toBe(true)
        }
      }
    }
  })

  it('refuses a missing platform or conflicting gate instead of silently skipping coverage', () => {
    expect(() =>
      selectChecks({ manifest, matrix, suite: 'regression', platform: 'freebsd' })
    ).toThrow(/coverage/)
    const conflicting = structuredClone(matrix)
    conflicting.platforms.windows.checks.push({
      ...manifest.suites.platform[0],
      argv: ['echo', 'skip']
    })
    expect(() =>
      selectChecks({ manifest, matrix: conflicting, suite: 'regression', platform: 'win32' })
    ).toThrow(/Conflicting/)
  })
})

describe('gate command line batching', () => {
  const invocation = {
    command: 'C:\\Program Files\\node.exe',
    args: [
      'C:\\Program Files\\pnpm.cjs',
      'exec',
      'vitest',
      'run',
      '--config',
      'config/vitest.config.ts'
    ]
  }
  const check = (paths) => ({
    id: 'repair-root-tests',
    category: 'diagnostic',
    kind: 'vitest',
    cwd: '.',
    argv: [invocation.command, ...invocation.args],
    paths
  })
  const longPaths = Array.from(
    { length: 180 },
    (_, index) => `src/测试😀 ${index}/${'x'.repeat(200)}.test.ts`
  )

  beforeEach(() => {
    vi.mocked(spawn).mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('refuses an empty Vitest path list instead of accidentally running an unfiltered suite', async () => {
    for (const paths of [[], undefined]) {
      expect(() => buildGateInvocations(check(paths), invocation)).toThrow(/test paths/)
      await expect(runCheck(check(paths), projectDir)).rejects.toThrow(/test paths/)
    }
    expect(spawn).not.toHaveBeenCalled()
  })

  it('preserves a short list and does not mutate its input', () => {
    const paths = Object.freeze(['src/first.test.ts', 'src/second.test.ts'])
    const base = Object.freeze({ ...invocation, args: Object.freeze([...invocation.args]) })
    expect(buildGateInvocations(check(paths), base)).toEqual([
      { command: invocation.command, args: [...invocation.args, ...paths] }
    ])
  })

  it.each([
    ['ASCII', Array.from({ length: 300 }, (_, i) => `src/${i}/${'x'.repeat(150)}.test.ts`)],
    ['Unicode', longPaths],
    [
      'quoted paths',
      Array.from({ length: 180 }, (_, i) => `src/space ${i}/a\\"${'字'.repeat(150)}\\`)
    ]
  ])('keeps every %s path exactly once and in order within the UTF-16 budget', (_name, paths) => {
    const batches = buildGateInvocations(check(paths), invocation)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.flatMap((batch) => batch.args.slice(invocation.args.length))).toEqual(paths)
    for (const batch of batches) {
      expect(batch.command).toBe(invocation.command)
      expect(batch.args.slice(0, invocation.args.length)).toEqual(invocation.args)
      expect(batch.args.length).toBeGreaterThan(invocation.args.length)
      expect(gateCommandLineLength(batch.command, batch.args)).toBeLessThanOrEqual(
        GATE_COMMAND_LINE_BUDGET
      )
    }
  })

  it('counts UTF-16, spaces, quoting, backslash escapes and the final NUL', () => {
    expect(gateCommandLineLength('n', [])).toBe(4) // "n" + NUL
    expect(gateCommandLineLength('n', ['😀'])).toBe(9)
    expect(gateCommandLineLength('n', ['a b'])).toBe(10)
    expect(gateCommandLineLength('n', ['a"b'])).toBe(11)
    expect(gateCommandLineLength('n', ['a\\"b'])).toBe(13)
    expect(gateCommandLineLength('n', ['a\\'])).toBe(10)
    expect(() => gateCommandLineLength('n', ['a\0b'])).toThrow(/NUL/)
  })

  it('includes the resolved CLI prefix and accepts an exact budget fit', () => {
    const paths = ['src/a.test.ts', 'src/b.test.ts']
    const budget = gateCommandLineLength(invocation.command, [...invocation.args, paths[0]])
    const batches = buildGateInvocations(check(paths), invocation, budget)
    expect(batches.map((batch) => batch.args.slice(invocation.args.length))).toEqual(
      paths.map((p) => [p])
    )
    expect(() => buildGateInvocations(check(paths), invocation, budget - 1)).toThrow(/index 0/)
  })

  it('rejects any individually oversized path before executing earlier valid paths', async () => {
    const paths = ['src/short.test.ts', 'x'.repeat(GATE_COMMAND_LINE_BUDGET)]
    await expect(runCheck(check(paths), projectDir)).rejects.toThrow(/index 1.*budget/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not batch non-Vitest commands even if they exceed this Vitest budget', () => {
    const command = { ...check(longPaths), kind: 'command' }
    expect(buildGateInvocations(command, invocation)).toEqual([
      { command: invocation.command, args: [...invocation.args, ...longPaths] }
    ])
  })

  function mockChildren(outcomes) {
    vi.mocked(spawn).mockImplementation(() => {
      const outcome = outcomes.shift() ?? 0
      if (outcome === 'throw') {
        throw new Error('synchronous spawn failure')
      }
      const child = new EventEmitter()
      child.stdout = { pipe: vi.fn() }
      child.stderr = { pipe: vi.fn() }
      queueMicrotask(() => {
        if (outcome === 'error') {
          child.emit('error', new Error('asynchronous spawn failure'))
          child.emit('close', 0) // A later close cannot turn the failure into success.
        } else {
          child.emit('close', outcome)
        }
      })
      return child
    })
  }

  it('passes only after every batch passes and keeps shell-free background execution', async () => {
    mockChildren([])
    expect(await runCheck(check(longPaths), projectDir)).toBe(true)
    const batches = buildGateInvocations(check(longPaths), invocation)
    expect(spawn).toHaveBeenCalledTimes(batches.length)
    expect(
      vi.mocked(spawn).mock.calls.flatMap(([, args]) => args.slice(invocation.args.length))
    ).toEqual(longPaths)
    for (const [, , options] of vi.mocked(spawn).mock.calls) {
      expect(options).toMatchObject({
        cwd: projectDir,
        shell: false,
        windowsHide: true,
        env: { ORCA_BACKGROUND_LAUNCH: '1' }
      })
    }
  })

  it('runs every direct Node Vitest batch after a failed batch without a pnpm or cmd hop', async () => {
    const selected = {
      ...check(longPaths),
      argv: ['pnpm', 'exec', 'vitest', 'run', '--config', 'config/vitest.config.ts']
    }
    const direct = resolveGateInvocation(selected, projectDir)
    mockChildren([7])
    expect(await runCheck(selected, projectDir)).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(buildGateInvocations(selected, direct).length)
    expect(
      vi.mocked(spawn).mock.calls.flatMap(([, args]) => args.slice(direct.args.length))
    ).toEqual(longPaths)
    for (const [command, args] of vi.mocked(spawn).mock.calls) {
      expect(command).toBe(process.execPath)
      expect(args.slice(0, direct.args.length)).toEqual(direct.args)
      expect(gateCommandLineLength(command, args)).toBeLessThanOrEqual(GATE_COMMAND_LINE_BUDGET)
    }
  })

  it.each([7, 'throw', 'error'])(
    'executes later batches after %s and returns failure for the whole check',
    async (failure) => {
      mockChildren([failure])
      expect(await runCheck(check(longPaths), projectDir)).toBe(false)
      expect(
        vi.mocked(spawn).mock.calls.flatMap(([, args]) => args.slice(invocation.args.length))
      ).toEqual(longPaths)
    }
  )

  it('does not hide a failure in the last batch behind earlier successful batches', async () => {
    const batches = buildGateInvocations(check(longPaths), invocation)
    mockChildren([...Array(batches.length - 1).fill(0), 7])
    expect(await runCheck(check(longPaths), projectDir)).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(batches.length)
    expect(
      vi.mocked(spawn).mock.calls.flatMap(([, args]) => args.slice(invocation.args.length))
    ).toEqual(longPaths)
  })
})

describe('Vitest graph-local direct Node launcher', () => {
  let root
  const check = {
    id: 'graph-tests',
    kind: 'vitest',
    cwd: 'mobile',
    argv: ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.config.ts'],
    paths: ['a.test.ts']
  }
  beforeEach(() => {
    const logs = join(projectDir, 'logs', 'gate-launcher-tests')
    mkdirSync(logs, { recursive: true })
    root = mkdtempSync(join(logs, 'case-'))
    vi.mocked(spawn).mockReset()
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  function install(
    cwd,
    manifest = { name: 'vitest', bin: { vitest: './vitest.mjs' } },
    entry = true
  ) {
    const directory = join(root, cwd, 'node_modules/vitest')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
    if (entry) {
      writeFileSync(join(directory, 'vitest.mjs'), '')
    }
    return join(directory, 'vitest.mjs')
  }
  it('uses precisely the selected graph and preserves all CLI arguments', () => {
    install('.')
    const entry = install('mobile')
    expect(resolveGateInvocation(check, root)).toEqual({
      command: process.execPath,
      args: [entry, ...check.argv.slice(3)]
    })
  })
  it('does not fall back to the installed parent graph when the selected graph is missing', async () => {
    install('.')
    await expect(runCheck(check, root)).rejects.toThrow(/Vitest unavailable/)
    expect(spawn).not.toHaveBeenCalled()
  })
  it.each([
    [{ name: 'other', bin: { vitest: './vitest.mjs' } }, true],
    [{ name: 'vitest', bin: { vitest: '../other.mjs' } }, true],
    [{ name: 'vitest', bin: {} }, true],
    [{ name: 'vitest', bin: './vitest.mjs' }, false]
  ])('rejects a mismatched package or missing CLI: %j', (manifest, entry) => {
    install('mobile', manifest, entry)
    expect(() => resolveGateInvocation(check, root)).toThrow(/Vitest unavailable/)
  })
  it('leaves non-Vitest command invocation unchanged', () => {
    expect(resolveGateInvocation({ kind: 'command', argv: ['node', 'script.mjs'] }, root)).toEqual({
      command: 'node',
      args: ['script.mjs']
    })
  })
})

describe('verification runtime prerequisites', () => {
  const jobs = parse(workflow).jobs
  it.each(['gates', 'platform-gates'])('prepares pinned runtimes in the read-only %s job', (id) => {
    const job = jobs[id]
    expect(job.permissions).toEqual({ contents: 'read' })
    const dependency = job.steps.find(
      (step) => step.uses === './.github/actions/install-node-dependencies'
    )
    expect(dependency.with['native-runtime']).toBe('node')
    const bun = job.steps.find((step) => step.uses?.startsWith('oven-sh/setup-bun@'))
    expect(bun.uses).toBe('oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6')
    expect(bun.with['bun-version-file']).toBe('config/.bun-version')
    const execute = job.steps.findIndex(
      (step) =>
        step.name ===
        (id === 'gates'
          ? 'Run common product verification once'
          : 'Execute the focused platform regression matrix')
    )
    expect(job.steps.indexOf(dependency)).toBeLessThan(execute)
    expect(job.steps.indexOf(bun)).toBeLessThan(execute)
  })
  it('requires actual browser resources before the common product checks', () => {
    const steps = jobs.gates.steps
    const execute = steps.findIndex((step) => step.name === 'Run common product verification once')
    const electron = steps.findIndex(
      (step) => step.run === 'node config/scripts/install-electron-package-binary.mjs'
    )
    const chrome = steps.findIndex(
      (step) => step.name === 'Resolve Chrome for actual mobile render checks'
    )
    expect(electron).toBeGreaterThan(-1)
    expect(chrome).toBeGreaterThan(-1)
    expect(electron).toBeLessThan(execute)
    expect(chrome).toBeLessThan(execute)
    expect(steps[chrome].run).toContain('command -v google-chrome')
    expect(steps[chrome].run).toContain('exit 1')
    expect(steps[chrome].run).toContain('ORCA_MOBILE_WEB_RENDER_BROWSER=$chrome')
    const webkit = steps.findIndex(
      (step) => step.name === 'Install WebKit for mobile render checks'
    )
    expect(webkit).toBeGreaterThan(-1)
    expect(webkit).toBeLessThan(execute)
    expect(steps[webkit].run).toBe('pnpm exec playwright-core install --with-deps webkit')
    expect(steps[webkit].if).toBeUndefined()
    expect(steps[webkit]['continue-on-error']).toBeUndefined()
    expect(steps[webkit].background).toBeUndefined()
    expect(jobs.publish.steps.some((step) => step.run?.includes('playwright-core install'))).toBe(
      false
    )
    expect(
      jobs.publish.steps.some(
        (step) =>
          step.uses?.startsWith('oven-sh/setup-bun@') ||
          step.run?.includes('install-electron-package-binary')
      )
    ).toBe(false)
  })
})
