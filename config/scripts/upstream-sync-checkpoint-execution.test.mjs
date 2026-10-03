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
    expect(prepareCrossVersionBaselines({ cwd: 'fixture-root' }).commits).toHaveLength(9)
    expect(execution.run).toHaveBeenCalledTimes(18)
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
