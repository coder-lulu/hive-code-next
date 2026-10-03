import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyAgentBunOwnership } from './agent-upgrade-target'

const { run, readFile, realpath } = vi.hoisted(() => ({
  run: vi.fn(),
  readFile: vi.fn(),
  realpath: vi.fn()
}))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: run }))
vi.mock('node:fs', () => ({ readFileSync: readFile, realpathSync: realpath }))
vi.mock('../../shared/node-cli-command-resolution', () => ({
  resolveCliCommands: vi.fn(),
  withCliRuntimeOnPath: (_cmd: string, env: NodeJS.ProcessEnv) => env
}))
vi.mock('../../shared/child-process/windows-cmd-shim-resolution', () => ({
  resolveWindowsCmdShim: () => null,
  parseWindowsCmdShim: () => null
}))

const packageBin = '/bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js'
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  run.mockResolvedValue({
    code: 0,
    stdout:
      '/bun/install/global node_modules (1 installed)\n└── @oh-my-pi/pi-coding-agent@18.1.19\n',
    stderr: '',
    timedOut: false
  })
  readFile.mockReturnValue(
    JSON.stringify({ name: '@oh-my-pi/pi-coding-agent', bin: { omp: 'dist/cli.js' } })
  )
  realpath.mockImplementation((value: string) => (value === '/bun/bin/omp' ? packageBin : value))
})
afterEach(() => vi.restoreAllMocks())

describe('Bun upgrade ownership', () => {
  it('requires the actual CLI to resolve to the declared bin in the observed global package root', async () => {
    expect(
      await verifyAgentBunOwnership({ agent: 'omp' }, '/bun/bin/omp', '/bun/bin/bun', {})
    ).toBe(true)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['pm', 'ls', '--global'], timeoutMs: 10_000 })
    )
    expect(readFile).toHaveBeenCalledWith(
      '/bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/package.json',
      'utf8'
    )
  })

  it('rejects a standalone in the same global bin even when matching package metadata remains', async () => {
    realpath.mockImplementation((value: string) => value)
    expect(
      await verifyAgentBunOwnership({ agent: 'omp' }, '/bun/bin/omp', '/bun/bin/bun', {})
    ).toBe(false)
  })

  it.each(['relative node_modules (1 installed)', '/bun/install/global', 'unexpected output'])(
    'rejects an unproven package root: %s',
    async (stdout) => {
      run.mockResolvedValue({ code: 0, stdout, stderr: '', timedOut: false })
      expect(
        await verifyAgentBunOwnership({ agent: 'omp' }, '/bun/bin/omp', '/bun/bin/bun', {})
      ).toBe(false)
      expect(readFile).not.toHaveBeenCalled()
    }
  )

  it('does not treat a Windows native exe plus stale Bun metadata as an owned script launcher', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    run.mockResolvedValue({
      code: 0,
      stdout: 'C:\\bun\\install\\global node_modules (1 installed)',
      stderr: '',
      timedOut: false
    })
    realpath.mockImplementation((value: string) => value)
    expect(
      await verifyAgentBunOwnership(
        { agent: 'omp' },
        'C:\\bun\\bin\\omp.exe',
        'C:\\bun\\bin\\bun.exe',
        {}
      )
    ).toBe(false)
  })
})
