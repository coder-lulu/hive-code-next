import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { runProcessSync } from '@orca/process-host'
import { resolveGitBashPath } from '../../src/main/git-bash'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifySyncBoundaryPath } from './audit-fork-delta.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const boundary = JSON.parse(
  readFileSync(join(projectDir, 'config/upstream-sync-boundary.json'), 'utf8')
)
const upstreamSyncWorkflow = readFileSync(
  join(projectDir, '.github/workflows/upstream-sync.yml'),
  'utf8'
)

describe('upstream synchronization boundary', () => {
  it('keeps all three maintained path lists non-empty and distinct', () => {
    const categories = ['productBoundary', 'directAbsorb', 'manualReview']
    for (const category of categories) {
      expect(boundary[category].paths.length, category).toBeGreaterThan(0)
      expect(new Set(boundary[category].paths).size, category).toBe(boundary[category].paths.length)
    }
  })

  it('synchronizes directly on the explicit product main branches', () => {
    expect(boundary.workflow.integrationMode).toBe('direct-product')
    expect(boundary.workflow.integrationBranch).toBeUndefined()
    expect(boundary.workflow.productBranches).toEqual(['hivecode/main-next', 'main'])
    expect(boundary.workflow.publication).toBe('verified-fast-forward')
  })

  it('keeps the large-module migration list tied to behavior contracts', () => {
    expect(boundary.moduleSplitTargets.length).toBeGreaterThan(0)
    expect(new Set(boundary.moduleSplitTargets.map((target) => target.path)).size).toBe(
      boundary.moduleSplitTargets.length
    )
    for (const target of boundary.moduleSplitTargets) {
      expect(existsSync(join(projectDir, target.path)), target.path).toBe(true)
      expect(target.facade, target.path).toEqual(expect.any(String))
      expect(target.sensitivity, target.path).toEqual(expect.any(String))
      expect(target.expectedBoundary, target.path).toBe('manualReview')
      expect(target.boundaryPaths.length, target.path).toBeGreaterThan(0)
      for (const boundaryPath of target.boundaryPaths) {
        expect(classifySyncBoundaryPath(boundaryPath), `${target.path} -> ${boundaryPath}`).toBe(
          'manualReview'
        )
      }
      expect(target.contractTests.length, target.path).toBeGreaterThan(0)
      for (const contractTest of target.contractTests) {
        expect(
          existsSync(join(projectDir, contractTest)),
          `${target.path} -> ${contractTest}`
        ).toBe(true)
      }
    }
  })

  it('publishes only the immutable verified candidate with a normal product push', () => {
    expect(upstreamSyncWorkflow).toContain('git bundle create')
    expect(upstreamSyncWorkflow).toContain('push origin "$CANDIDATE_SHA:refs/heads/$TARGET_BRANCH"')
    expect(upstreamSyncWorkflow).not.toContain('vendor-integration')
    expect(upstreamSyncWorkflow).not.toContain('--force-with-lease')
    expect(upstreamSyncWorkflow).not.toContain('gh pr ')
  })
})

function fixtureGitEnvironment(inherited, emptyConfig) {
  // Git hooks and alternate-index callers can redirect even an explicit cwd.
  // Strip all Git overrides before adding the fixture's own configuration.
  return {
    ...Object.fromEntries(Object.entries(inherited).filter(([name]) => !/^GIT_/i.test(name))),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_SYSTEM: emptyConfig,
    GIT_ATTR_NOSYSTEM: '1'
  }
}

it.each(['index', 'repository selectors'])(
  'extracts every frozen control archive without changing the caller %s',
  (pollution) => {
    const fixtureRoot = join(projectDir, 'logs/upstream-sync/control-extraction')
    mkdirSync(fixtureRoot, { recursive: true })
    const fixture = mkdtempSync(join(fixtureRoot, 'runner path '))
    const workspace = join(fixture, 'workspace')
    const caller = join(fixture, 'caller')
    const runnerTemp = join(workspace, 'native runner temp')
    const control = join(runnerTemp, 'upstream-sync-control')
    const emptyConfig = join(fixture, 'empty.gitconfig')
    const bash = process.platform === 'win32' ? resolveGitBashPath() : 'bash'
    if (!bash) {
      throw new Error('Git Bash is required for frozen control archive fixtures on Windows')
    }
    let env = fixtureGitEnvironment(process.env, emptyConfig)
    const run = (program, args, options = {}) => {
      const result = runProcessSync({ program, args, cwd: workspace, env, ...options })
      expect(result.code, result.stderr).toBe(0)
      return result.stdout.trim()
    }
    try {
      mkdirSync(join(workspace, 'config'), { recursive: true })
      mkdirSync(caller, { recursive: true })
      mkdirSync(control, { recursive: true })
      writeFileSync(emptyConfig, '')
      writeFileSync(join(caller, 'caller-only.txt'), 'preserve caller staged state\n')
      run('git', ['init', '--quiet'], { cwd: caller })
      run('git', ['add', 'caller-only.txt'], { cwd: caller })
      const callerIndex = join(caller, '.git/index')
      const callerIndexBefore = readFileSync(callerIndex)
      const callerConfigBefore = readFileSync(join(caller, '.git/config'))
      const selectors =
        pollution === 'repository selectors'
          ? {
              GIT_DIR: join(caller, '.git'),
              GIT_COMMON_DIR: join(caller, '.git'),
              GIT_WORK_TREE: caller,
              GIT_OBJECT_DIRECTORY: join(caller, '.git/objects'),
              GIT_ALTERNATE_OBJECT_DIRECTORIES: join(caller, 'absent-objects'),
              GIT_CONFIG_COUNT: '1',
              GIT_CONFIG_KEY_0: 'core.worktree',
              GIT_CONFIG_VALUE_0: caller,
              GIT_CONFIG_PARAMETERS: "'core.worktree=invalid'",
              GIT_EXEC_PATH: join(caller, 'absent-tools')
            }
          : {}
      env = {
        ...fixtureGitEnvironment(
          { ...process.env, ...selectors, GIT_INDEX_FILE: callerIndex },
          emptyConfig
        ),
        RUNNER_TEMP: runnerTemp,
        ORCA_BACKGROUND_LAUNCH: '1'
      }
      writeFileSync(join(workspace, 'config/probe.mjs'), 'export const marker = "frozen-control"\n')
      writeFileSync(join(workspace, 'package.json'), '{"name":"control-fixture"}\n')
      run('git', ['init', '--quiet'])
      run('git', ['add', 'config', 'package.json'])
      expect(readFileSync(callerIndex)).toEqual(callerIndexBefore)
      expect(readFileSync(join(caller, '.git/config'))).toEqual(callerConfigBefore)
      env.TARGET_SHA = run('git', ['write-tree'])
      expect(run('git', ['ls-files'])).toBe('config/probe.mjs\npackage.json')
      expect(readFileSync(callerIndex)).toEqual(callerIndexBefore)
      expect(readFileSync(join(caller, '.git/config'))).toEqual(callerConfigBefore)
      const commands = [
        ...upstreamSyncWorkflow.matchAll(/^\s*(git(?: --no-replace-objects)? archive .*\|.*)$/gm)
      ].map((match) => match[1])
      expect(commands).toHaveLength(5)
      for (const command of commands) {
        run(bash, [
          '--noprofile',
          '--norc',
          '-c',
          `set -euo pipefail\ntarget_sha="$TARGET_SHA"\n${command}`
        ])
        expect(
          run(process.execPath, [
            '--input-type=module',
            '-e',
            [
              "import { pathToFileURL } from 'node:url'",
              'const root = process.env.RUNNER_TEMP',
              "const { marker } = await import(pathToFileURL(root + '/upstream-sync-control/config/probe.mjs'))",
              'process.stdout.write(marker)'
            ].join('\n')
          ])
        ).toBe('frozen-control')
        writeFileSync(
          join(control, 'config/probe.mjs'),
          'export const marker = "candidate-control"\n'
        )
      }
      expect(readFileSync(callerIndex)).toEqual(callerIndexBefore)
      expect(readFileSync(join(caller, '.git/config'))).toEqual(callerConfigBefore)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  }
)
