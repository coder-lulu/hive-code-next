import { mkdirSync, mkdtempSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node-pty'
import { expect, it, vi } from 'vitest'
import { resolveWindowsPowerShellExecutablePath } from './windows-powershell-executable'
import { readWindowsConsoleAttachedProcessIds } from './windows-console-attached-processes'
import { resolveWindowsAgentForegroundProcessWithAvailability } from './windows-agent-foreground-process'

it.skipIf(process.platform !== 'win32')(
  'confirms a real native Pi in ConPTY, then refuses agent identity after it exits',
  async () => {
    const evidenceRoot = resolve('logs/native-pi/foreground')
    mkdirSync(evidenceRoot, { recursive: true })
    const account = mkdtempSync(join(evidenceRoot, 'account-'))
    const runtime = resolve('runtime/native-pi')
    const shell = resolveWindowsPowerShellExecutablePath('powershell.exe')
    if (!shell) {
      throw new Error('Windows PowerShell is required for the native foreground test')
    }
    const proc = spawn(shell, ['-NoLogo', '-NoProfile'], {
      cwd: account,
      cols: 140,
      rows: 30,
      useConptyDll: true,
      env: {
        ...process.env,
        ORCA_BACKGROUND_LAUNCH: '1',
        PI_CODING_AGENT_DIR: account,
        HIVECODE_AI_BASE_URL: 'http://127.0.0.1:1/v1',
        HIVECODE_AI_LOCAL_TOKEN: 'isolated-no-inference-fixture',
        HIVECODE_AI_MODELS: JSON.stringify([
          { id: 'fixture', api: 'openai-completions', contextWindow: 32768, maxTokens: 4096 }
        ])
      }
    })
    let output = ''
    proc.onData((chunk) => {
      output += chunk
    })
    const inspect = () =>
      resolveWindowsAgentForegroundProcessWithAvailability(proc.pid, basename(shell), {
        fresh: true,
        forceProcessScan: true,
        readWindowsConsoleAttachedProcessIds: () => readWindowsConsoleAttachedProcessIds(proc.pid)
      })
    try {
      await vi.waitFor(() => expect(output).toContain('PS '), { timeout: 15000 })
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
      proc.write(
        `& ${quote(process.execPath)} --import ${quote(pathToFileURL(join(runtime, 'launcher.mjs')).href)} ${quote(join(runtime, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'))} --offline --no-session\r`
      )
      await vi.waitFor(
        async () => {
          expect(await inspect()).toMatchObject({ available: true, processName: 'pi' })
        },
        { timeout: 20000 }
      )
      proc.write('\x04')
      await vi.waitFor(
        async () => {
          expect(await inspect()).toMatchObject({ available: true, processName: null })
        },
        { timeout: 15000 }
      )
    } finally {
      proc.kill()
    }
  },
  60000
)
