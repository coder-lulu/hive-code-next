import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('./run-ssh-docker-e2e.mjs', import.meta.url), 'utf8').replace(
  /^import .*\n/gm,
  ''
)
async function run({
  template = '/fixture/orcad-template',
  exists = true,
  codes = [0, 0],
  args = [],
  spawnError
} = {}) {
  const pendingCodes = [...codes]
  const spawnProcess = vi.fn(() => {
    const child = new EventEmitter()
    queueMicrotask(() => {
      if (spawnError) {
        child.emit('error', spawnError)
      } else {
        child.emit('exit', pendingCodes.shift())
      }
    })
    return child
  })
  const exit = vi.fn((code) => {
    throw Object.assign(new Error('exit'), { code })
  })
  const stderr = vi.fn()
  let code
  try {
    await runInNewContext(`(async () => {${source}\n})()`, {
      spawnProcess,
      existsSync: vi.fn(() => exists),
      console: { error: stderr },
      process: {
        argv: ['node', 'runner', ...args],
        platform: 'linux',
        env: template ? { ORCA_E2E_ORCAD_CONVERT_TEMPLATE: template } : {},
        exit
      }
    })
  } catch (error) {
    if (!exit.mock.calls.length) {
      throw error
    }
    code = error.code
  }
  return { spawnProcess, stderr, code }
}

describe('managed Docker SSH runner', () => {
  it.each([{ template: '' }, { exists: false }])(
    'fails before spawning when the template is unavailable: %j',
    async (options) => {
      const result = await run(options)
      expect(result.code).toBe(1)
      expect(result.spawnProcess).not.toHaveBeenCalled()
      expect(result.stderr).toHaveBeenCalledWith(
        expect.stringContaining('ORCA_E2E_ORCAD_CONVERT_TEMPLATE')
      )
    }
  )
  it('does not continue after Electron runtime preparation fails', async () => {
    const result = await run({ codes: [7] })
    expect(result.code).toBe(7)
    expect(result.spawnProcess).toHaveBeenCalledTimes(1)
    expect(result.spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({ program: 'pnpm', args: ['run', 'ensure:electron-runtime'] })
    )
  })
  it('runs the actual managed lane and preserves bounded execution and CLI arguments', async () => {
    const result = await run({ codes: [0, 9], args: ['--', '--grep', 'host owner'] })
    expect(result.code).toBe(9)
    expect(result.spawnProcess).toHaveBeenCalledTimes(2)
    const [options] = result.spawnProcess.mock.calls[1]
    const { program, args } = options
    expect(program).toBe('pnpm')
    expect(args).toEqual([
      'exec',
      'playwright',
      'test',
      'tests/e2e/ssh-orcad-',
      '--config',
      'tests/playwright.config.ts',
      '--project',
      'electron-headless',
      '--workers=1',
      '--grep',
      'host owner'
    ])
    expect(options).toMatchObject({
      stdio: 'inherit',
      env: {
        ORCA_E2E_SSH_DOCKER: '1',
        ORCA_E2E_ORCAD_CONVERT_HOST: 'docker',
        ORCA_E2E_ORCAD_CONVERT_TEMPLATE: '/fixture/orcad-template'
      }
    })
    expect(options.env.ORCA_E2E_LOCAL_SSH_BROWSER).toBeUndefined()
    expect(options.env.ORCA_E2E_SSH_CLIENT_HOSTED_BROWSER).toBeUndefined()
  })
  it('propagates preparation spawn failure without running the managed lane', async () => {
    await expect(run({ spawnError: new Error('spawn refused') })).rejects.toThrow('spawn refused')
  })
  it('treats a missing exit status as a failure', async () => {
    expect((await run({ codes: [0, null] })).code).toBe(1)
  })
})
