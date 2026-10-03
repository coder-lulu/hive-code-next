import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCliCommands } from '../../shared/node-cli-command-resolution'
import { downloadAgentInstaller } from './agent-installer-download'

export async function installOfficialScript(
  url: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[]
) {
  const data = await downloadAgentInstaller(url)
  const directory = mkdtempSync(path.join(tmpdir(), 'hive-agent-install-'))
  const windows = process.platform === 'win32'
  const script = path.join(directory, windows ? 'install.ps1' : 'install.sh')
  try {
    writeFileSync(script, data, { mode: 0o600 })
    const runtime = windows ? 'powershell' : 'bash'
    const program = resolveCliCommands([runtime], { pathEnv: env.PATH ?? env.Path }).get(runtime)
    if (!program) {
      throw new Error('installer-runtime-unavailable')
    }
    return await runProcess({
      program,
      args: windows
        ? [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'RemoteSigned',
            '-File',
            script,
            ...args
          ]
        : [script, ...args],
      env,
      terminationBarrier: true,
      timeoutMs: 120_000,
      maxOutputBytes: 64 * 1024
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
