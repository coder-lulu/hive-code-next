import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readAgentVersion, readLatestAgentVersion } from './agent-version-service'
import { quoteAgentExecutable } from './agent-upgrade-target'
import type {
  AgentVersionRequest,
  LatestAgentVersionRequest
} from '../../shared/agent-version-types'

const { run, runWsl, resolveCommands, buildEnv, hydratePath, fetchMetadata } = vi.hoisted(() => ({
  run: vi.fn(),
  runWsl: vi.fn(),
  resolveCommands: vi.fn(),
  buildEnv: vi.fn(),
  hydratePath: vi.fn(),
  fetchMetadata: vi.fn()
}))

vi.mock('../../shared/child-process/run-process', () => ({ runProcess: run }))
vi.mock('../../shared/node-cli-command-resolution', () => ({
  resolveCliCommands: resolveCommands,
  withCliRuntimeOnPath: (_program: string, env: NodeJS.ProcessEnv) => env
}))
vi.mock('../wsl/wsl-runner', () => ({ runWslProcess: runWsl }))
vi.mock('../ipc/preflight-local-env', () => ({ buildLocalPreflightEnv: buildEnv }))
vi.mock('../ipc/agent-detection-shell-path', () => ({
  hydrateShellPathForAgentDetection: hydratePath
}))
vi.mock('../network/http-client', () => ({
  getMainHttpClient: () => ({ fetch: fetchMetadata })
}))

describe('current agent versions on the execution host', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    buildEnv.mockReturnValue({ Path: 'C:\\tools' })
    hydratePath.mockResolvedValue(undefined)
    resolveCommands.mockImplementation(
      (commands: string[]) =>
        new Map(commands.map((command) => [command, `C:\\tools\\${command}.cmd`]))
    )
    run.mockResolvedValue({ code: 0, stdout: 'codex-cli 0.106.0\n', stderr: '', timedOut: false })
    runWsl.mockResolvedValue({
      environmentResolved: true,
      code: 0,
      stdout: '0.68.0\n',
      stderr: '',
      timedOut: false
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it.each([undefined, 'Ubuntu'])('refuses truncated version output on %s', async (wslDistro) => {
    const result = {
      environmentResolved: true,
      code: 0,
      stdout: 'codex-cli 1.2.3\n',
      stderr: '',
      timedOut: false,
      outputTruncated: true
    }
    run.mockResolvedValue(result)
    runWsl.mockResolvedValue(result)
    expect(await readAgentVersion({ agent: 'codex', wslDistro })).toEqual({
      status: 'error',
      version: null,
      reason: 'version-output-unverifiable'
    })
  })

  it('resolves the Windows npm shim and invokes the bounded shared runner', async () => {
    expect(await readAgentVersion({ agent: 'codex' })).toEqual({
      status: 'ready',
      version: '0.106.0'
    })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        program: 'C:\\tools\\codex.cmd',
        args: ['--version'],
        timeoutMs: 5000,
        maxOutputBytes: 32 * 1024,
        env: { Path: 'C:\\tools' }
      })
    )
    expect(runWsl).not.toHaveBeenCalled()
  })

  it('uses the selected WSL distro and command override without resolving a host binary', async () => {
    expect(
      await readAgentVersion({
        agent: 'pi',
        wslDistro: 'Ubuntu-24.04',
        commandOverride: '/opt/pi/bin/pi'
      })
    ).toEqual({ status: 'ready', version: '0.68.0' })
    expect(runWsl).toHaveBeenCalledWith(
      expect.objectContaining({
        distro: 'Ubuntu-24.04',
        script: expect.stringContaining("_orca_lookup_command='/opt/pi/bin/pi'"),
        loginPath: 'preferred',
        timeoutMs: 5000
      })
    )
    expect(run).not.toHaveBeenCalled()
    expect(resolveCommands).not.toHaveBeenCalled()
    expect(runWsl.mock.calls[0][0].script).toContain('exec "$resolved" --version')
    expect(runWsl.mock.calls[0][0].script).toContain('drvfs')
  })

  it('does not run on the host when WSL is requested on an unsupported host platform', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(await readAgentVersion({ agent: 'codex', wslDistro: 'Ubuntu' })).toMatchObject({
      status: 'unsupported',
      version: null
    })
    expect(run).not.toHaveBeenCalled()
    expect(runWsl).not.toHaveBeenCalled()
  })

  it('runs on a POSIX Runtime host rather than inheriting Windows command syntax', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    buildEnv.mockReturnValue(undefined)
    resolveCommands.mockReturnValue(new Map([['codex', '/home/dev/.local/bin/codex']]))
    expect(await readAgentVersion({ agent: 'codex' })).toMatchObject({ status: 'ready' })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ program: '/home/dev/.local/bin/codex', args: ['--version'] })
    )
    expect(runWsl).not.toHaveBeenCalled()
  })

  it('accepts a quoted executable path containing spaces as one program', async () => {
    await readAgentVersion({
      agent: 'codex',
      commandOverride: '"C:\\Program Files\\Codex\\codex.exe"'
    })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ program: 'C:\\Program Files\\Codex\\codex.exe' })
    )
  })

  it.each([
    ['win32', "C:\\Users\\O'Brien\\AppData\\Roaming\\npm\\codex.cmd"],
    ['win32', "C:\\Users\\O'Brien Dev\\AppData\\Roaming\\npm\\codex.cmd"],
    ['linux', "/home/o'brien/.local/bin/codex"],
    ['darwin', "/Users/O'Brien Dev/.local/bin/codex"],
    ['linux', '/home/dev\tname/.local/bin/codex'],
    ['linux', '/home/dev/"quoted"/bin/codex'],
    ['linux', '/home/dev/back\\slash/bin/codex']
  ] as const)(
    'verifies the installed CLI at its exact special-character path on %s',
    async (platform, executable) => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
      expect(
        await readAgentVersion({
          agent: 'codex',
          commandOverride: quoteAgentExecutable(executable)
        })
      ).toMatchObject({ status: 'ready', version: '0.106.0' })
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ program: executable }))
      expect(runWsl).not.toHaveBeenCalled()
    }
  )

  it('quotes a special-character guest path with POSIX syntax when the host is Windows', async () => {
    const executable = "/home/o'brien\tdev/.local/bin/codex"
    expect(
      await readAgentVersion({
        agent: 'codex',
        wslDistro: 'Ubuntu',
        commandOverride: quoteAgentExecutable(executable, 'Ubuntu')
      })
    ).toMatchObject({ status: 'ready' })
    expect(runWsl.mock.calls[0][0].script).toContain(
      "_orca_lookup_command='/home/o'\\''brien\tdev/.local/bin/codex'"
    )
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['codex --model example', 'codex; echo secret', '$(codex)', 'codex\nother', 'npx codex'])(
    'does not execute the complex override %s',
    async (commandOverride) => {
      expect(await readAgentVersion({ agent: 'codex', commandOverride })).toMatchObject({
        status: 'unsupported',
        version: null
      })
      expect(run).not.toHaveBeenCalled()
      expect(runWsl).not.toHaveBeenCalled()
    }
  )

  it('keeps a WSL environment failure independent from installation state', async () => {
    runWsl.mockResolvedValue({
      environmentResolved: false,
      code: 127,
      stdout: '',
      stderr: 'not found',
      timedOut: false
    })
    expect(await readAgentVersion({ agent: 'codex', wslDistro: 'Ubuntu' })).toMatchObject({
      status: 'error',
      version: null,
      reason: 'environment-unverifiable'
    })
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    { code: 1, stdout: '', stderr: 'failure', timedOut: false },
    { code: null, stdout: '0.106.0', stderr: '', timedOut: true },
    { code: 0, stdout: 'Welcome! Please log in', stderr: '', timedOut: false },
    { code: 0, stdout: '0.106.0', stderr: '', timedOut: false, outputTruncated: true }
  ])('reports a read error for an unsuccessful or unverifiable probe', async (result) => {
    run.mockResolvedValue(result)
    expect(await readAgentVersion({ agent: 'codex' })).toMatchObject({
      status: 'error',
      version: null
    })
  })

  it('preserves prerelease/build version identity and reads stderr-only version output', async () => {
    run.mockResolvedValue({
      code: 0,
      stdout: '',
      stderr: 'gemini 0.59.0-preview.1+abc123\n',
      timedOut: false
    })
    expect(await readAgentVersion({ agent: 'gemini' })).toEqual({
      status: 'ready',
      version: '0.59.0-preview.1+abc123'
    })
  })

  it('does not treat a spawn failure as missing installation', async () => {
    run.mockRejectedValue(new Error('ENOENT'))
    expect(await readAgentVersion({ agent: 'codex' })).toMatchObject({
      status: 'error',
      version: null
    })
  })

  it.each([
    ['grok', 'grok 1.0.30 (04b7ffed98c6)\n', '1.0.30', 'grok', ['version']],
    [
      'hermes',
      'Hermes Agent v0.19.1 (2026.7.30)\nInstall directory: /opt/hermes\nPython: 3.11.15\n',
      '0.19.1',
      'hermes',
      ['--version']
    ],
    ['omp', 'omp/18.1.6\n', '18.1.6', 'omp', ['--version']],
    ['aider', 'aider 0.86.1\n', '0.86.1', 'aider', ['--version']],
    ['droid', '0.93.0\n', '0.93.0', 'droid', ['--version']],
    ['ante', 'ante version 1.2.3\n', '1.2.3', 'ante', ['--version']],
    ['claude-agent-teams', '2.1.198 (Claude Code)\n', '2.1.198', 'claude', ['--version']]
  ] as const)(
    'reads the actual %s CLI independently of its installation provider',
    async (agent, stdout, version, executable, args) => {
      run.mockResolvedValue({ code: 0, stdout, stderr: '', timedOut: false })
      expect(await readAgentVersion({ agent })).toEqual({ status: 'ready', version })
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ program: `C:\\tools\\${executable}.cmd`, args })
      )
      expect(fetchMetadata).not.toHaveBeenCalled()
    }
  )

  it('uses the official Grok version subcommand on the selected WSL host', async () => {
    runWsl.mockResolvedValue({
      environmentResolved: true,
      code: 0,
      stdout: 'grok 1.0.30 (04b7ffed98c6)\n',
      stderr: '',
      timedOut: false
    })
    expect(await readAgentVersion({ agent: 'grok', wslDistro: 'Ubuntu' })).toMatchObject({
      status: 'ready',
      version: '1.0.30'
    })
    expect(runWsl.mock.calls[0][0].script).toContain('exec "$resolved" version')
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    { agent: 'unknown' },
    { agent: 'codex', connectionId: 'ssh-other-host' },
    { agent: 'codex', commandOverride: null }
  ])('rejects invalid current requests before host execution', async (request) => {
    expect(await readAgentVersion(request as unknown as AgentVersionRequest)).toMatchObject({
      status: 'error',
      version: null,
      reason: 'invalid-version-request'
    })
    expect(run).not.toHaveBeenCalled()
    expect(runWsl).not.toHaveBeenCalled()
  })
})

describe('upstream npm stable-channel agent versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries only the selected China registry and reports that exact source', async () => {
    fetchMetadata.mockResolvedValue(
      new Response(JSON.stringify({ name: '@openai/codex', version: '1.2.3' }))
    )
    expect(await readLatestAgentVersion({ agent: 'codex', registry: 'china' })).toMatchObject({
      status: 'ready',
      version: '1.2.3',
      sourceUrl: 'https://registry.npmmirror.com/@openai/codex/latest'
    })
    expect(fetchMetadata).toHaveBeenCalledTimes(1)
    expect(fetchMetadata).toHaveBeenCalledWith(
      'https://registry.npmmirror.com/@openai/codex/latest',
      expect.any(Object)
    )
  })

  it('does not fall back to the default registry if the selected source fails', async () => {
    fetchMetadata.mockRejectedValue(new Error('mirror unavailable'))
    expect(await readLatestAgentVersion({ agent: 'codex', registry: 'china' })).toMatchObject({
      status: 'error',
      version: null,
      sourceUrl: 'https://registry.npmmirror.com/@openai/codex/latest'
    })
    expect(fetchMetadata).toHaveBeenCalledTimes(1)
  })

  it('keeps concurrent queries isolated by their explicitly selected sources', async () => {
    fetchMetadata.mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            name: '@openai/codex',
            version: url.startsWith('https://registry.npmmirror.com/') ? '1.2.3' : '1.2.4'
          })
        )
      )
    )
    const results = await Promise.all([
      readLatestAgentVersion({ agent: 'codex', registry: 'default' }),
      readLatestAgentVersion({ agent: 'codex', registry: 'china' })
    ])
    expect(results[0]).toMatchObject({
      version: '1.2.4',
      sourceUrl: 'https://registry.npmjs.org/@openai/codex/latest'
    })
    expect(results[1]).toMatchObject({
      version: '1.2.3',
      sourceUrl: 'https://registry.npmmirror.com/@openai/codex/latest'
    })
    expect(fetchMetadata).toHaveBeenCalledTimes(2)
  })

  it('cancels oversized metadata instead of consuming an unbounded upstream body', async () => {
    const cancel = vi.fn()
    fetchMetadata.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024 + 1))
          },
          cancel
        })
      )
    )
    expect(await readLatestAgentVersion({ agent: 'codex' })).toMatchObject({
      status: 'error',
      version: null,
      reason: 'latest-metadata-unverifiable'
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each(['https://registry.example.org', 'DEFAULT', '', null])(
    'rejects invalid registry %s before making an upstream request',
    async (registry) => {
      expect(
        await readLatestAgentVersion({
          agent: 'codex',
          registry
        } as unknown as LatestAgentVersionRequest)
      ).toMatchObject({ status: 'error', version: null, reason: 'invalid-version-request' })
      expect(fetchMetadata).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['claude', '@anthropic-ai/claude-code'],
    ['codex', '@openai/codex'],
    ['gemini', '@google/gemini-cli'],
    ['pi', '@earendil-works/pi-coding-agent'],
    ['opencode', 'opencode-ai']
  ] as const)('uses the verified fixed package endpoint for %s', async (agent, packageName) => {
    fetchMetadata.mockResolvedValue(
      new Response(JSON.stringify({ name: packageName, version: '1.2.3' }))
    )
    expect(await readLatestAgentVersion({ agent })).toMatchObject({
      status: 'ready',
      version: '1.2.3',
      packageName,
      sourceUrl: `https://registry.npmjs.org/${packageName}/latest`,
      channel: 'npm-latest'
    })
    expect(fetchMetadata).toHaveBeenCalledWith(
      `https://registry.npmjs.org/${packageName}/latest`,
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    )
    expect(run).not.toHaveBeenCalled()
    expect(runWsl).not.toHaveBeenCalled()
  })

  it('does not send an upstream request for an unsupported agent', async () => {
    expect(await readLatestAgentVersion({ agent: 'ante' })).toMatchObject({
      status: 'unsupported',
      version: null,
      channel: 'npm-latest'
    })
    expect(fetchMetadata).not.toHaveBeenCalled()
  })

  it.each([
    new Response('unavailable', { status: 503 }),
    new Response(JSON.stringify({ name: '@other/codex', version: '1.2.3' })),
    new Response(JSON.stringify({ name: '@openai/codex', version: 'latest' })),
    new Response(JSON.stringify({ name: '@openai/codex', version: '1.2.3-preview.1' })),
    new Response('invalid json')
  ])('keeps failed or invalid npm metadata separate from the current version', async (response) => {
    fetchMetadata.mockResolvedValue(response)
    expect(await readLatestAgentVersion({ agent: 'codex' })).toMatchObject({
      status: 'error',
      version: null,
      channel: 'npm-latest'
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('reports upstream network failure without hiding the installed agent', async () => {
    fetchMetadata.mockRejectedValue(new Error('offline'))
    expect(await readLatestAgentVersion({ agent: 'codex' })).toMatchObject({
      status: 'error',
      version: null,
      packageName: '@openai/codex',
      channel: 'npm-latest'
    })
  })
})

describe('official non-npm stable latest versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the Hermes release name SemVer instead of the calendar release tag', async () => {
    fetchMetadata.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'Hermes Agent v0.21.2 (v2026.9.11)',
          tag_name: 'v2026.9.11',
          draft: false,
          prerelease: false
        })
      )
    )
    expect(await readLatestAgentVersion({ agent: 'hermes', registry: 'china' })).toMatchObject({
      status: 'ready',
      version: '0.21.2',
      channel: 'github-release',
      sourceUrl: 'https://api.github.com/repos/NousResearch/hermes-agent/releases/latest'
    })
    expect(fetchMetadata).toHaveBeenCalledTimes(1)
  })

  it.each([
    { name: 'Hermes Agent v0.21.2 (v2026.9.11)', draft: true, prerelease: false },
    { name: 'Hermes Agent v0.22.0-preview.1', draft: false, prerelease: true },
    { name: 'Hermes Agent v2026.9.11', tag_name: 'v2026.9.11', draft: false, prerelease: false },
    { tag_name: 'v2026.9.11', draft: false, prerelease: false },
    { message: 'rate limit exceeded' }
  ])('rejects unverifiable Hermes metadata without substituting PyPI', async (metadata) => {
    fetchMetadata.mockResolvedValue(new Response(JSON.stringify(metadata)))
    expect(await readLatestAgentVersion({ agent: 'hermes' })).toMatchObject({
      status: 'error',
      version: null,
      channel: 'github-release'
    })
    expect(fetchMetadata).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['aider', 'aider-chat'],
    ['mistral-vibe', 'mistral-vibe']
  ] as const)(
    'reads verified %s project from PyPI independently of npm registry selection',
    async (agent, packageName) => {
      fetchMetadata.mockResolvedValue(
        new Response(
          JSON.stringify({
            info: { name: packageName, version: '0.86.2' },
            urls: [{ yanked: false }]
          })
        )
      )
      expect(await readLatestAgentVersion({ agent, registry: 'china' })).toMatchObject({
        status: 'ready',
        version: '0.86.2',
        packageName,
        channel: 'pypi-latest',
        sourceUrl: `https://pypi.org/pypi/${packageName}/json`
      })
      expect(fetchMetadata).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    { info: { name: 'aider', version: '0.86.2' }, urls: [{ yanked: false }] },
    { info: { name: 'aider-chat', version: '0.87.0rc1' }, urls: [{ yanked: false }] },
    { info: { name: 'aider-chat', version: '0.87.0-preview.1' }, urls: [{ yanked: false }] },
    { info: { name: 'aider-chat', version: '0.86.2' }, urls: [{ yanked: true }] },
    { info: { name: 'aider-chat', version: '0.86.2' }, urls: [] }
  ])(
    'does not report mismatched, prerelease, or yanked PyPI metadata as latest',
    async (metadata) => {
      fetchMetadata.mockResolvedValue(new Response(JSON.stringify(metadata)))
      expect(await readLatestAgentVersion({ agent: 'aider' })).toMatchObject({
        status: 'error',
        version: null,
        channel: 'pypi-latest'
      })
    }
  )
})
