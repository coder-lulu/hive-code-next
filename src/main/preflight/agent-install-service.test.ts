import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type * as WindowsCmdShimModule from '../../shared/child-process/windows-cmd-shim-resolution'
import { installAgent } from './agent-install-service'
import { mergePathSegments } from '../startup/hydrate-shell-path'

const { run, runWsl, guest, current, latest, readPackage, realpath, resolveShim, resolveCommands } =
  vi.hoisted(() => ({
    run: vi.fn(),
    runWsl: vi.fn(),
    guest: vi.fn(),
    current: vi.fn(),
    latest: vi.fn(),
    readPackage: vi.fn(),
    realpath: vi.fn(),
    resolveShim: vi.fn(),
    resolveCommands: vi.fn()
  }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: run }))
vi.mock('../../shared/node-cli-command-resolution', () => ({
  resolveCliCommands: resolveCommands,
  withCliRuntimeOnPath: (_program: string, env: NodeJS.ProcessEnv) => env
}))
vi.mock('../ipc/agent-detection-shell-path', () => ({ hydrateShellPathForAgentDetection: vi.fn() }))
vi.mock('../ipc/preflight-local-env', () => ({
  buildLocalPreflightEnv: () => ({ Path: 'C:\\tools' })
}))
vi.mock('../startup/hydrate-shell-path', () => ({ mergePathSegments: vi.fn() }))
vi.mock('../wsl/wsl-guest-environment', () => ({ getWslGuestEnvironment: guest }))
vi.mock('../wsl/wsl-runner', () => ({ runWslProcess: runWsl }))
vi.mock('./agent-version-service', () => ({
  readAgentVersion: current,
  readLatestAgentVersion: latest
}))
vi.mock('node:fs', () => ({ readFileSync: readPackage, realpathSync: realpath }))
vi.mock('../../shared/child-process/windows-cmd-shim-resolution', async (importOriginal) => ({
  ...(await importOriginal<typeof WindowsCmdShimModule>()),
  resolveWindowsCmdShim: resolveShim
}))

describe('controlled agent installation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    resolveCommands.mockImplementation(
      (commands: string[]) => new Map(commands.map((c) => [c, `C:\\tools\\${c}.cmd`]))
    )
    run.mockImplementation(async ({ args }: { args: string[] }) => ({
      code: 0,
      stdout: args[0] === 'prefix' ? 'C:\\tools\n' : 'installed\n',
      stderr: '',
      timedOut: false
    }))
    guest.mockResolvedValue({
      path: '/home/dev/.nvm/bin:/usr/bin',
      home: '/home/dev',
      envBinary: '/usr/bin/env'
    })
    runWsl.mockResolvedValue({
      code: 0,
      stdout: 'installed\n__HIVE_AGENT_INSTALL_PREFIX__/home/dev/.nvm\n',
      stderr: '',
      timedOut: false,
      environmentResolved: true
    })
    current.mockResolvedValue({ status: 'ready', version: '1.2.3' })
    latest.mockResolvedValue({ status: 'ready', version: '2.0.0' })
    readPackage.mockReturnValue(
      JSON.stringify({ name: '@openai/codex', bin: { codex: 'bin/codex.js' } })
    )
    realpath.mockImplementation((value) => value)
    resolveShim.mockReturnValue({
      program: 'C:\\tools\\node.exe',
      prefixArgs: ['C:\\tools\\node_modules\\@openai\\codex\\bin\\codex.js']
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('refuses to replace a Homebrew-owned binary without a matching Homebrew adapter', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    realpath.mockReturnValue('/home/linuxbrew/.linuxbrew/Cellar/acli/1.0.0/bin/acli')
    const result = await installAgent({
      agent: 'rovo',
      action: 'upgrade',
      commandOverride: '/home/linuxbrew/.linuxbrew/bin/acli'
    })
    expect(result).toMatchObject({ status: 'error', reason: 'upgrade-provider-unavailable' })
    expect(current).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('installs only the fixed official package and verifies the resulting executable', async () => {
    expect(await installAgent({ agent: 'codex' })).toEqual({
      status: 'installed',
      version: '1.2.3'
    })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'C:\\tools\\npm.cmd',
        args: [
          'install',
          '--global',
          '@openai/codex@latest',
          '--registry',
          'https://registry.npmjs.org',
          '--no-fund',
          '--no-audit',
          '--engine-strict'
        ],
        timeoutMs: 120_000,
        terminationBarrier: true
      })
    )
    expect(current).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'codex', commandOverride: 'C:\\tools\\codex.cmd' })
    )
    expect(runWsl).not.toHaveBeenCalled()
  })

  it('deduplicates simultaneous clicks and rejects other same-host installs until completion', async () => {
    const first = installAgent({ agent: 'codex' })
    expect(installAgent({ agent: 'codex' })).toBe(first)
    expect(await installAgent({ agent: 'gemini' })).toMatchObject({
      status: 'error',
      reason: 'install-busy'
    })
    await first
    await installAgent({ agent: 'gemini' })
    const installs = run.mock.calls.filter(([spec]) => spec.args[0] === 'install')
    expect(installs).toHaveLength(2)
    expect(installs.map(([spec]) => spec.args[2])).toEqual([
      '@openai/codex@latest',
      '@google/gemini-cli@latest'
    ])
  })

  it('uses the selected domestic registry for download and nested package-manager operations', async () => {
    await installAgent({ agent: 'grok', registry: 'china' })
    const spec = run.mock.calls.find(([value]) => value.args[0] === 'install')![0]
    expect(spec.args).toContain('@xai-official/grok@latest')
    expect(spec.args).toContain('https://registry.npmmirror.com')
    expect(spec.env.npm_config_registry).toBe('https://registry.npmmirror.com')
  })

  it('upgrades the active npm installation and verifies it reached the selected source version', async () => {
    current
      .mockResolvedValueOnce({ status: 'ready', version: '1.0.0' })
      .mockResolvedValueOnce({ status: 'ready', version: '2.0.0' })
    expect(await installAgent({ agent: 'codex', action: 'upgrade', registry: 'china' })).toEqual({
      status: 'installed',
      version: '2.0.0',
      previousVersion: '1.0.0'
    })
    expect(latest).toHaveBeenCalledWith({ agent: 'codex', registry: 'china' })
    const spec = run.mock.calls.find(([value]) => value.args[0] === 'install')![0]
    expect(spec.args).toEqual(
      expect.arrayContaining([
        '--prefix',
        'C:\\tools',
        '--registry',
        'https://registry.npmmirror.com'
      ])
    )
  })

  it('does not install a competing npm copy when the current installation has no supported updater', async () => {
    readPackage.mockImplementation(() => {
      throw new Error('No npm owner')
    })
    expect(await installAgent({ agent: 'codex', action: 'upgrade' })).toMatchObject({
      reason: 'upgrade-provider-unavailable'
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('resolves npm and node from the upgraded installation before the inherited PATH', async () => {
    current
      .mockResolvedValueOnce({ status: 'ready', version: '1.0.0' })
      .mockResolvedValueOnce({ status: 'ready', version: '2.0.0' })
    await installAgent({ agent: 'codex', action: 'upgrade' })
    expect(resolveCommands).toHaveBeenCalledWith(
      ['npm', 'node'],
      expect.objectContaining({ pathEnv: expect.stringMatching(/^C:\\tools(?:;|$)/) })
    )
    const spec = run.mock.calls.find(([value]) => value.args[0] === 'install')![0]
    expect(spec.env.PATH).toMatch(/^C:\\tools(?:;|$)/)
  })

  it('does not promote an upgraded installation ahead of the existing launch PATH', async () => {
    current
      .mockResolvedValueOnce({ status: 'ready', version: '1.0.0' })
      .mockResolvedValueOnce({ status: 'ready', version: '2.0.0' })
    await installAgent({ agent: 'codex', action: 'upgrade' })
    expect(mergePathSegments).not.toHaveBeenCalled()
  })

  it('updates a native Grok installation through its own CLI without requiring npm', async () => {
    readPackage.mockImplementation(() => {
      throw new Error('Native installation')
    })
    current
      .mockResolvedValueOnce({ status: 'ready', version: '1.0.0' })
      .mockResolvedValueOnce({ status: 'ready', version: '2.0.0' })
    expect(await installAgent({ agent: 'grok', action: 'upgrade' })).toMatchObject({
      status: 'installed',
      version: '2.0.0'
    })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'C:\\tools\\grok.cmd',
        args: ['update'],
        terminationBarrier: true
      })
    )
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not report an upgrade when the command exits successfully but the active CLI stays old', async () => {
    current.mockResolvedValue({ status: 'ready', version: '1.0.0' })
    expect(await installAgent({ agent: 'codex', action: 'upgrade' })).toMatchObject({
      reason: 'install-verification-failed'
    })
  })

  it('does not mistake a native Claude exe beside a stale npm package for the npm installation', async () => {
    readPackage.mockReturnValue(
      JSON.stringify({ name: '@anthropic-ai/claude-code', bin: { claude: 'cli.js' } })
    )
    resolveShim.mockReturnValue(null)
    resolveCommands.mockImplementation(
      (commands: string[]) => new Map(commands.map((c) => [c, `C:\\tools\\${c}.exe`]))
    )
    current
      .mockResolvedValueOnce({ status: 'ready', version: '1.0.0' })
      .mockResolvedValueOnce({ status: 'ready', version: '2.0.0' })
    await installAgent({ agent: 'claude', action: 'upgrade' })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ program: 'C:\\tools\\claude.exe', args: ['update'] })
    )
    expect(run.mock.calls.some(([spec]) => spec.args[0] === 'install')).toBe(false)
  })

  it('upgrades a verified Bun-interpreter npm OMP shim in its original npm prefix', async () => {
    resolveShim.mockReturnValue(null)
    const shim =
      '@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT /b\n:start\nSETLOCAL\nCALL :find_dp0\nIF EXIST "%dp0%\\bun.exe" (\nSET "_prog=%dp0%\\bun.exe"\n) ELSE (\nSET "_prog=bun"\nSET PATHEXT=%PATHEXT:;.JS;=;%\n)\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\\node_modules\\@oh-my-pi\\pi-coding-agent\\dist\\cli.js" %*'
    readPackage.mockImplementation((file: string) =>
      file.endsWith('.cmd')
        ? shim
        : JSON.stringify({ name: '@oh-my-pi/pi-coding-agent', bin: { omp: 'dist/cli.js' } })
    )
    run.mockImplementation(async ({ args }: { args: string[] }) => ({
      code: 0,
      stdout: args[0] === '--version' ? '1.3.14' : args[0] === 'prefix' ? 'C:\\other-prefix' : '',
      stderr: '',
      timedOut: false
    }))
    current
      .mockResolvedValueOnce({ status: 'ready', version: '1.0.0' })
      .mockResolvedValueOnce({ status: 'ready', version: '2.0.0' })
    expect(
      await installAgent({ agent: 'omp', action: 'upgrade', registry: 'china' })
    ).toMatchObject({ status: 'installed', version: '2.0.0' })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'C:\\tools\\npm.cmd',
        args: expect.arrayContaining([
          '@oh-my-pi/pi-coding-agent@latest',
          '--prefix',
          'C:\\tools',
          '--registry',
          'https://registry.npmmirror.com'
        ])
      })
    )
    expect(run.mock.calls.some(([spec]) => spec.args[0] === 'update')).toBe(false)
  })

  it('rejects an arbitrary registry and invalid action before any execution', async () => {
    expect(
      await installAgent({ agent: 'codex', registry: 'https://malicious.invalid' } as never)
    ).toMatchObject({ reason: 'invalid-install-request' })
    expect(await installAgent({ agent: 'codex', action: 'remove' } as never)).toMatchObject({
      reason: 'invalid-install-request'
    })
    expect(run).not.toHaveBeenCalled()
    expect(current).not.toHaveBeenCalled()
  })

  it('refuses unsupported agents and caller-supplied commands before execution', async () => {
    expect(await installAgent({ agent: 'unknown-agent' } as never)).toMatchObject({
      status: 'error'
    })
    expect(await installAgent({ agent: 'mimo-code' })).toMatchObject({ status: 'unsupported' })
    expect(await installAgent({ agent: 'codex', command: 'malicious' } as never)).toMatchObject({
      status: 'error'
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('reports missing Node/npm without starting an install', async () => {
    run.mockRejectedValue(new Error('ENOENT'))
    expect(await installAgent({ agent: 'codex' })).toMatchObject({
      status: 'error',
      reason: 'node-npm-unavailable'
    })
    expect(current).not.toHaveBeenCalled()
  })

  it.each([
    [{ code: 1, timedOut: false }, 'install-failed'],
    [{ code: null, timedOut: true }, 'install-timeout']
  ])('surfaces install errors and never marks them installed', async (result, reason) => {
    run.mockImplementation(async ({ args }: { args: string[] }) =>
      args[0] === 'install'
        ? { ...result, stdout: '', stderr: 'network unavailable' }
        : {
            code: 0,
            stdout: args[0] === 'prefix' ? 'C:\\tools' : 'v24.0.0',
            stderr: '',
            timedOut: false
          }
    )
    expect(await installAgent({ agent: 'codex' })).toMatchObject({
      status: 'error',
      reason,
      output: 'network unavailable'
    })
    expect(current).not.toHaveBeenCalled()
  })

  it('does not fabricate success when the installed CLI cannot report a version', async () => {
    current.mockResolvedValue({ status: 'error', version: null })
    expect(await installAgent({ agent: 'codex' })).toMatchObject({
      status: 'error',
      reason: 'install-verification-failed'
    })
  })

  it('does not verify a different copy outside the actual npm global directory', async () => {
    resolveCommands.mockImplementation(
      (commands: string[]) => new Map(commands.map((c) => [c, `C:\\other\\${c}.cmd`]))
    )
    expect(await installAgent({ agent: 'codex' })).toMatchObject({
      reason: 'install-verification-failed'
    })
    expect(current).not.toHaveBeenCalled()
  })

  it('installs on the selected WSL guest with its proven login PATH', async () => {
    expect(await installAgent({ agent: 'gemini', wslDistro: 'Ubuntu' })).toMatchObject({
      status: 'installed'
    })
    expect(runWsl).toHaveBeenCalledWith(
      expect.objectContaining({
        distro: 'Ubuntu',
        loginPath: 'none',
        script: expect.stringContaining("'@google/gemini-cli@latest'")
      })
    )
    expect(runWsl.mock.calls[0][0].script).toContain('drvfs')
    expect(runWsl.mock.calls[0][0].script).toContain('npm global bin directory must be on PATH')
    expect(runWsl.mock.calls[0][0].script).toContain('--kill-after=5s 110s')
    expect(run).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledWith(expect.objectContaining({ wslDistro: 'Ubuntu' }))
  })

  it('does not mutate an unverifiable WSL guest or fall back to the native host', async () => {
    guest.mockResolvedValue(null)
    expect(await installAgent({ agent: 'codex', wslDistro: 'Ubuntu' })).toMatchObject({
      reason: 'environment-unverifiable'
    })
    expect(runWsl).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('reports guest timeout without a success verification or native fallback', async () => {
    runWsl.mockResolvedValue({
      code: 124,
      stdout: '',
      stderr: '',
      timedOut: false,
      environmentResolved: true
    })
    expect(await installAgent({ agent: 'codex', wslDistro: 'Ubuntu' })).toMatchObject({
      reason: 'install-timeout'
    })
    expect(current).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('does not install natively when WSL is requested on a non-Windows host', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(await installAgent({ agent: 'codex', wslDistro: 'Ubuntu' })).toMatchObject({
      status: 'unsupported'
    })
    expect(run).not.toHaveBeenCalled()
  })
})
