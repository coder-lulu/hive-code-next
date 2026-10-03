import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { quoteStartupArg } from '../../shared/tui-agent-startup-shell'
import { AGENT_INSTALL_PROVIDERS } from '../../shared/agent-install-providers'
import { buildManagedGuestInstallScript } from './agent-managed-install-guest'

const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh'
const posix = (file: string) =>
  file.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)
const quote = (value: string) => quoteStartupArg(value, 'posix')

it.skipIf(!existsSync(shell))(
  'executes the guest upgrade and verifies the selected uv entry behind another PATH installation',
  async () => {
    const root = path.resolve('logs/agent-install-review/guest-fixtures')
    mkdirSync(root, { recursive: true })
    const fixture = mkdtempSync(path.join(root, 'uv-'))
    const directories = ['default', 'managed', 'tools'].map((name) => path.join(fixture, name))
    for (const directory of directories) {
      mkdirSync(directory)
    }
    const [defaultBin, managedBin, tools] = directories
    const selected = posix(path.join(managedBin, 'aider'))
    const marker = path.join(fixture, 'upgraded')
    for (const [directory, version] of [
      [defaultBin, '1.0.0'],
      [managedBin, '2.0.0']
    ]) {
      writeFileSync(path.join(directory, 'aider'), `#!/bin/sh\nprintf 'aider ${version}\\n'\n`, {
        mode: 0o755
      })
    }
    writeFileSync(
      path.join(tools, 'uv'),
      [
        '#!/bin/sh',
        'case "$1 $2" in',
        `  'tool dir') printf '%s\\n' ${quote(posix(managedBin))} ;;`,
        `  'tool upgrade') printf upgraded > ${quote(posix(marker))} ;;`,
        '  *) exit 1 ;;',
        'esac'
      ].join('\n'),
      { mode: 0o755 }
    )
    const script = buildManagedGuestInstallScript(
      {
        agent: 'aider',
        action: 'upgrade',
        commandOverride: quote(selected),
        expectedRealPath: selected
      },
      AGENT_INSTALL_PROVIDERS.aider!,
      {
        path: [...directories.map(posix), '/usr/bin', '/bin'].join(':'),
        home: posix(fixture),
        envBinary: '/usr/bin/env'
      }
    )!
    const result = await runProcess({
      program: shell,
      args: ['-s'],
      input: script,
      timeoutMs: 10_000,
      maxOutputBytes: 4096
    })
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`__HIVE_AGENT_COMMAND__${selected}`)
    expect(readFileSync(marker, 'utf8')).toBe('upgraded')
  },
  15_000
)
