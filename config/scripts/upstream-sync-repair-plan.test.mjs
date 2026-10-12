import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  existsSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOptions, selectChecks, runCheck, reportPath } from './run-upstream-sync-gates.mjs'
import { planRepairChecks, discoverChangedPaths } from './upstream-sync-repair-plan.mjs'

const checks = [
  'brand',
  'hivecloud',
  'updater',
  'mobile',
  'runtime-rpc',
  'platform',
  'generated',
  'lockfile'
].map((category) => ({
  id: category,
  category,
  kind: 'command',
  cwd: '.',
  argv: ['node', '--version']
}))
const plan = (paths) => planRepairChecks(checks, paths, () => true)
describe('repair verification boundaries', () => {
  it('preserves default final selection and refuses selective final arguments', () => {
    expect(parseOptions([]).phase).toBe('final')
    expect(selectChecks({ manifest: { suites: { common: checks } } })).toEqual(checks)
    expect(() => parseOptions([`--changed-from=${'a'.repeat(40)}`])).toThrow(/repair/)
    expect(() => parseOptions(['--phase=repair'])).toThrow(/changed-from/)
    expect(() => parseOptions(['--phase=repair', '--changed-from=HEAD'])).toThrow(/SHA/)
    expect(() =>
      parseOptions(['--phase=repair', `--changed-from=${'a'.repeat(40)}`, '--suite=mobile'])
    ).toThrow(/suite/)
    expect(() => parseOptions(['--phase=final', '--skip=mobile'])).toThrow(/Unknown/)
  })
  it('falls back to all fixed checks for shared, config, dependencies and unknown paths', () => {
    for (const file of [
      'src/shared/x.ts',
      'config/a.json',
      'package.json',
      'mobile/package.json',
      'new/x.ts'
    ]) {
      expect(plan([file]).checks).toEqual(checks)
    }
  })
  it('limits known leaf changes while keeping unconditional checks', () => {
    const ids = plan(['src/main/updater/feed.ts']).checks.map((check) => check.id)
    expect(ids).toContain('updater')
    expect(ids).toContain('brand')
    expect(ids).not.toContain('mobile')
  })
  it('adds changed root and mobile tests once and avoids fixed coverage duplication', () => {
    const fixed = {
      id: 'mobile',
      category: 'mobile',
      kind: 'vitest',
      cwd: 'mobile',
      argv: ['pnpm', 'exec', 'vitest', 'run'],
      paths: ['src/a.test.ts']
    }
    const result = planRepairChecks(
      [fixed],
      [
        'mobile/src/a.test.ts',
        'mobile/src/b.test.ts',
        'mobile/src/b.test.ts',
        'src/main/new.test.ts'
      ],
      () => true
    )
    expect(result.checks.find((check) => check.id === 'repair-mobile-tests').paths).toEqual([
      'src/b.test.ts'
    ])
    expect(result.checks.find((check) => check.id === 'repair-root-tests').paths).toEqual([
      'src/main/new.test.ts'
    ])
    expect(result.formalAcceptance).toBe(false)
  })
  it('refuses unsafe direct test paths and does not execute deleted tests', () => {
    for (const file of [
      '../x.test.ts',
      '/x.test.ts',
      'src/x\n.test.ts',
      'C:/x.test.ts',
      'src/../x.test.ts',
      'src\\x.test.ts'
    ]) {
      expect(() => plan([file])).toThrow(/Unsafe/)
    }
    expect(planRepairChecks(checks, ['src/main/gone.test.ts'], () => false).checks).toEqual(checks)
  })
  it('discovers committed, staged, unstaged and untracked paths without shell parsing', () => {
    const calls = []
    const git = (args) => {
      calls.push(args)
      return args[0] === 'rev-parse'
        ? `${'a'.repeat(40)}\n`
        : args[0] === 'ls-files'
          ? 'mobile/src/new.test.ts\0'
          : 'src/main/updater/a.ts\0src/shared/deleted.ts\0'
    }
    expect(discoverChangedPaths('a'.repeat(40), git)).toEqual([
      'mobile/src/new.test.ts',
      'src/main/updater/a.ts',
      'src/shared/deleted.ts'
    ])
    expect(calls.some((args) => args.includes('--cached'))).toBe(true)
    expect(calls.some((args) => args.includes('--exclude-standard'))).toBe(true)
    expect(() => discoverChangedPaths('HEAD', git)).toThrow(/SHA/)
    expect(() =>
      discoverChangedPaths('a'.repeat(40), () => {
        throw new Error('missing commit')
      })
    ).toThrow(/missing commit/)
  })
})

describe('diagnostic process execution', () => {
  it('preserves shell metacharacters as literal arguments and records child failure', async () => {
    const literal = 'spaces & %PATH% ! ^ " quoted'
    const base = { id: 'argv', category: 'diagnostic', cwd: '.' }
    expect(
      await runCheck(
        {
          ...base,
          argv: [
            process.execPath,
            '-e',
            `process.exit(process.argv[1] === ${JSON.stringify(literal)} ? 0 : 1)`,
            literal
          ]
        },
        process.cwd()
      )
    ).toBe(true)
    expect(
      await runCheck({ ...base, argv: [process.execPath, '-e', 'process.exit(7)'] }, process.cwd())
    ).toBe(false)
  })
  it('rejects official acceptance filenames and destinations outside logs', () => {
    for (const file of [
      'logs/common-gates.json',
      'logs/regression-windows.json',
      '../report.json'
    ]) {
      expect(() => reportPath(process.cwd(), file)).toThrow(/acceptance|logs/)
    }
  })
})

describe('archived trusted control', () => {
  it('runs checks and discovers checkout changes without source or dependencies', async () => {
    const root = resolve(import.meta.dirname, '../..')
    const logs = join(root, 'logs/sync-efficiency/gates')
    mkdirSync(logs, { recursive: true })
    const archive = mkdtempSync(join(logs, 'archived-control-'))
    const scripts = join(archive, 'config/scripts')
    mkdirSync(scripts, { recursive: true })
    for (const name of [
      'run-upstream-sync-gates.mjs',
      'upstream-sync-repair-plan.mjs',
      'pnpm-cli-invocation.mjs'
    ]) {
      copyFileSync(join(root, 'config/scripts', name), join(scripts, name))
    }
    const cli = join(archive, 'pinned-pnpm.cjs')
    writeFileSync(cli, 'process.exit(process.argv[2] === "literal & %PATH%" ? 0 : 4)')
    const probe = join(archive, 'probe.mjs')
    writeFileSync(
      probe,
      `
      import { runCheck, discoverCheckoutChanges } from './config/scripts/run-upstream-sync-gates.mjs'
      process.env.npm_execpath = ${JSON.stringify(cli)}
      const passed = await runCheck({ id: 'archived-pnpm', category: 'diagnostic', cwd: '.', argv: ['pnpm', 'literal & %PATH%'] }, ${JSON.stringify(archive)})
      const changed = discoverCheckoutChanges(process.argv[2], ${JSON.stringify(root)})
      if (!passed || !Array.isArray(changed)) process.exit(3)
    `
    )
    expect(
      await runCheck(
        {
          id: 'archive-probe',
          category: 'diagnostic',
          cwd: '.',
          argv: [
            process.execPath,
            probe,
            execFileSync('git', ['rev-parse', 'HEAD'], {
              cwd: root,
              encoding: 'utf8',
              windowsHide: true
            }).trim()
          ]
        },
        archive
      )
    ).toBe(true)
  })
})

describe('report filesystem boundaries', () => {
  const fixture = () => {
    const logs = resolve(import.meta.dirname, '../../logs/sync-efficiency/gates')
    mkdirSync(logs, { recursive: true })
    const root = mkdtempSync(join(logs, 'report-path-'))
    mkdirSync(join(root, 'config'))
    return root
  }
  it('rejects logs junctions and parent junctions into checkout source before creating directories', () => {
    for (const rootLink of [true, false]) {
      const root = fixture()
      if (!rootLink) {
        mkdirSync(join(root, 'logs'))
      }
      symlinkSync(join(root, 'config'), join(root, rootLink ? 'logs' : 'logs/link'), 'junction')
      expect(() =>
        reportPath(root, rootLink ? 'logs/new/report.json' : 'logs/link/new/report.json')
      ).toThrow(/symlink|junction/)
      expect(existsSync(join(root, 'config/new'))).toBe(false)
    }
  })
  it('rejects a dangling report leaf rather than following it on write', () => {
    const root = fixture()
    mkdirSync(join(root, 'logs'))
    symlinkSync(join(root, 'missing'), join(root, 'logs/report.json'), 'junction')
    expect(() => reportPath(root, 'logs/report.json')).toThrow(/symlink|junction/)
  })
})
