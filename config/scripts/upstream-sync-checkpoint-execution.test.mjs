import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGit } from './upstream-sync-checkpoint.mjs'
import { prepareCrossVersionBaselines } from './prepare-cross-version-baselines.mjs'

const execution = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync: execution.run }))

beforeEach(() => {
  execution.run.mockReset()
})
afterEach(() => {
  execution.run.mockReset()
  vi.unstubAllEnvs()
})

describe('checkpoint Git execution boundary', () => {
  it('preserves the existing default stdin, encoding, visibility and buffer contract', () => {
    execution.run.mockReturnValue('result')
    expect(createGit('fixture-root')(['hash-object', '--stdin'], 'fixture input')).toBe('result')
    const [binary, args, options] = execution.run.mock.calls[0]
    expect(binary).toBe('git')
    expect(args).toEqual(['hash-object', '--stdin'])
    expect(options).toMatchObject({
      cwd: 'fixture-root',
      input: 'fixture input',
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 128 * 1024 * 1024
    })
    expect(options.env).toBeUndefined()
    expect(options.timeout).toBeUndefined()
  })

  it('accepts explicit bounds and environment without overriding the execution safety flags', () => {
    const env = { GIT_CONFIG_NOSYSTEM: '1' }
    createGit('fixture-root', {
      env,
      timeoutMs: 300_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: false,
      stdio: 'inherit',
      encoding: 'buffer',
      cwd: 'other-root'
    })(['rev-parse', 'HEAD'])
    const options = execution.run.mock.calls[0][2]
    expect(options.env).toBe(env)
    expect(options).toMatchObject({
      cwd: 'fixture-root',
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8'
    })
  })

  it('uses the existing boundary for the preparer and strips caller-selected Git roots', () => {
    vi.stubEnv('GIT_DIR', 'untrusted-git-dir')
    vi.stubEnv('GIT_WORK_TREE', 'untrusted-worktree')
    vi.stubEnv('GIT_INDEX_FILE', 'untrusted-index')
    execution.run.mockImplementation((binary, args) => {
      expect(binary).toBe('git')
      expect(args[0]).toBe('rev-parse')
      return args.at(-1).replace(/\^\{commit\}$/, '')
    })
    expect(prepareCrossVersionBaselines({ cwd: 'fixture-root' }).commits).toEqual([
      'd802fdc7429f5f9d959b99a73656545bd760eace',
      '2307f2ebbe1c1e737c0b12d920bb0a208332db2c',
      '11aba8bdc5e492d3ba01fc7fe333495ace74128f',
      '5534462b50c660888487a2108700d4cf284270db',
      '7468e9cccb35a8494f76dc95a37627121113ee80',
      '75ea50273328d9bd5465170d10a098711d61b5a4',
      'e705cac04a1db7e7e2184746e912142d34ca838b',
      '3727100cc9dbcea6201f8a3e506676a3c4b53b18',
      'aac38d698ff75ac4c8658addab48ef5a83617619',
      'b49abdb1f4da6b3d62dfa9ccf3c74dc9e74d291c',
      'f97ca2a49d9c711dab54a656a7f8a47ae6c6749c',
      '28957d6004dd191b6f0baff493a9fd3d37405d9d',
      '6e4f817101daa18d82824b69243d9079baa9c416',
      'd937d22f498505c017634be9bf0540c9fa42e665',
      '4cb013c0a9251275fa3d20ea33b45429e07aa6be',
      '4bb337741c335cfcc428d3b4271023566e2dadb8',
      'fd9125ea8c7b347cd8b675a4095e31cd3c865d25'
    ])
    expect(execution.run).toHaveBeenCalledTimes(34)
    for (const [, , options] of execution.run.mock.calls) {
      expect(options.env.GIT_DIR).toBeUndefined()
      expect(options.env.GIT_WORK_TREE).toBeUndefined()
      expect(options.env.GIT_INDEX_FILE).toBeUndefined()
      expect(options.cwd).toBe('fixture-root')
      expect(options.timeout).toBe(300_000)
      expect(options.maxBuffer).toBe(16 * 1024 * 1024)
      expect(options.windowsHide).toBe(true)
      expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    }
    const source = readFileSync(
      new URL('./prepare-cross-version-baselines.mjs', import.meta.url),
      'utf8'
    )
    expect(source).not.toMatch(
      /from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]|import\(\s*['"](?:node:)?child_process['"]/
    )
  })
})
