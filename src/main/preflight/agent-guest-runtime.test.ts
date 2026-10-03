import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { quoteStartupArg } from '../../shared/tui-agent-startup-shell'
import { readAgentVersion } from './agent-version-service'
import { buildAgentInstallationsGuestScript } from './agent-installations-guest'
import { buildNpmGuestInstallScript } from './agent-npm-install-guest'

const wsl = vi.hoisted(() => vi.fn())
vi.mock('../wsl/wsl-runner', () => ({ runWslProcess: wsl }))
vi.mock('../network/http-client', () => ({ getMainHttpClient: vi.fn() }))
vi.mock('../ipc/agent-detection-shell-path', () => ({ hydrateShellPathForAgentDetection: vi.fn() }))
vi.mock('../ipc/preflight-local-env', () => ({ buildLocalPreflightEnv: vi.fn() }))

const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh'
const posix = (file: string) =>
  file.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)
const quote = (value: string) => quoteStartupArg(value, 'posix')
afterEach(() => vi.restoreAllMocks())

function fixture(sibling = true) {
  const root = path.resolve('logs/agent-install-review-2/runtime-fixtures')
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(path.join(root, 'node space-'))
  const inherited = path.join(dir, 'old-node')
  const selected = path.join(dir, 'selected', 'bin')
  mkdirSync(inherited)
  mkdirSync(selected, { recursive: true })
  const upgraded = path.join(dir, 'upgraded')
  const write = (file: string, body: string) =>
    writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  write(path.join(inherited, 'node'), sibling ? 'exit 1' : 'printf "3.0.0\\n"')
  if (sibling) {
    write(path.join(selected, 'node'), 'if [ "$1" = -e ]; then exit 0; fi\nprintf "2.0.0\\n"')
  }
  writeFileSync(path.join(selected, 'codex'), '#!/usr/bin/env node\n', { mode: 0o755 })
  write(path.join(selected, 'npm'), `printf upgraded > ${quote(posix(upgraded))}`)
  return {
    command: posix(path.join(selected, 'codex')),
    upgraded,
    guest: {
      home: posix(dir),
      path: [posix(inherited), posix(selected), '/usr/bin', '/bin'].join(':'),
      envBinary: '/usr/bin/env'
    }
  }
}

it.skipIf(!existsSync(shell)).each([true, false])(
  'reads the selected guest CLI with sibling Node when present: %s',
  async (sibling) => {
    const f = fixture(sibling)
    wsl.mockResolvedValue({ code: 0, stdout: '2.0.0', stderr: '', environmentResolved: true })
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    await readAgentVersion({
      agent: 'codex',
      wslDistro: 'fixture',
      commandOverride: quote(f.command)
    })
    const script = wsl.mock.calls.at(-1)![0].script
    platform.mockRestore()
    const result = await runProcess({
      program: shell,
      args: ['-s'],
      input: `PATH=${quote(f.guest.path)}; export PATH\n${script}`,
      timeoutMs: 10_000
    })
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe(sibling ? '2.0.0' : '3.0.0')
  }
)

it.skipIf(!existsSync(shell))(
  'uses each guest candidate runtime when proving npm ownership',
  async () => {
    const f = fixture()
    const script = buildAgentInstallationsGuestScript(
      { agent: 'codex', wslDistro: 'fixture' },
      f.guest
    )
    const result = await runProcess({
      program: shell,
      args: ['-s'],
      input: script,
      timeoutMs: 10_000
    })
    expect(result.code).toBe(0)
    const fields = result.stdout.split('\0')
    expect(fields[5]).toBe('npm')
  }
)

it.skipIf(!existsSync(shell))(
  'pairs Node before npm ownership proof rather than rejecting the selected install',
  async () => {
    const f = fixture()
    const script = buildNpmGuestInstallScript(
      {
        agent: 'codex',
        action: 'upgrade',
        wslDistro: 'fixture',
        commandOverride: quote(f.command)
      },
      '@openai/codex',
      f.guest
    )
    const result = await runProcess({
      program: shell,
      args: ['-s'],
      input: script,
      timeoutMs: 10_000
    })
    expect(result.code).toBe(0)
    expect(readFileSync(f.upgraded, 'utf8')).toBe('upgraded')
  }
)
