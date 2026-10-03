import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { AgentInstallRequest } from '../../shared/agent-install-types'
import { AGENT_UPGRADE_COMMANDS } from '../../shared/agent-install-providers'
import { resolveCliCommands, withCliRuntimeOnPath } from '../../shared/node-cli-command-resolution'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { quoteStartupArg, tokenizeStartupCommand } from '../../shared/tui-agent-startup-shell'
import { runProcess } from '../../shared/child-process/run-process'
import { stripAnsiEscapeSequences } from '../../shared/ansi-escape-sequences'
import {
  parseWindowsCmdShim,
  resolveWindowsCmdShim
} from '../../shared/child-process/windows-cmd-shim-resolution'

export type AgentUpgradeTarget = {
  command: string
  prefix?: string
  args?: readonly string[]
}

export function agentExecutable(request: AgentInstallRequest): string | null {
  const command = request.commandOverride?.trim() || TUI_AGENT_CONFIG[request.agent].detectCmd
  if (/[;&|<>$`\r\n\0]/.test(command)) {
    return null
  }
  const parsed = tokenizeStartupCommand(
    command,
    process.platform === 'win32' && !request.wslDistro ? 'powershell' : 'posix'
  )
  return parsed.ok && parsed.tokens.length === 1 ? parsed.tokens[0] : null
}

export function quoteAgentExecutable(command: string, wslDistro?: string | null): string {
  const windows = process.platform === 'win32' && !wslDistro
  const barePath = windows ? /^[A-Za-z0-9_./:\\-]+$/ : /^[A-Za-z0-9_./:-]+$/
  return barePath.test(command)
    ? command
    : quoteStartupArg(command, windows ? 'powershell' : 'posix')
}

export function withAgentCommandOnPath(command: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const paired = withCliRuntimeOnPath(command, env)
  const windows = process.platform === 'win32'
  const directory = (windows ? path.win32 : path.posix).dirname(command)
  const keys = Object.keys(paired).filter((key) =>
    windows ? key.toLowerCase() === 'path' : key === 'PATH'
  )
  const delimiter = windows ? ';' : ':'
  const segments = (paired[keys[0] ?? 'PATH'] ?? '').split(delimiter).filter(Boolean)
  const result = { ...paired }
  for (const key of keys) {
    delete result[key]
  }
  result.PATH = [
    directory,
    ...segments.filter((segment) =>
      windows ? segment.toLowerCase() !== directory.toLowerCase() : segment !== directory
    )
  ].join(delimiter)
  return result
}

function bunShimTarget(command: string): string | null {
  if (!command.toLowerCase().endsWith('.cmd')) {
    return null
  }
  const contents = readFileSync(command, 'utf8')
  if (Buffer.byteLength(contents, 'utf8') > 64 * 1024) {
    return null
  }
  // Preserve the full generated shim grammar; only normalize its interpreter lines.
  const normalized = contents
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim()
      if (/^(?:@?IF EXIST |SET "_prog=|"(?:%~dp0|%dp0%)|bun )/i.test(trimmed)) {
        return line.replace(/\bbun(?=\.exe"|"$| +")/gi, 'node')
      }
      return line
    })
    .join('\n')
  if (normalized === contents) {
    return null
  }
  const parsed = parseWindowsCmdShim(normalized)
  return parsed?.kind === 'node'
    ? path.win32.resolve(path.win32.dirname(command), parsed.script)
    : null
}

function isAgentPackageExecutable(
  request: AgentInstallRequest,
  command: string,
  packageName: string,
  packageFile: string,
  env: NodeJS.ProcessEnv
): boolean {
  const hostPath = process.platform === 'win32' ? path.win32 : path.posix
  try {
    const metadata = JSON.parse(readFileSync(packageFile, 'utf8'))
    const name = TUI_AGENT_CONFIG[request.agent].detectCmd
    const declaredBin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.[name]
    if (metadata.name === packageName && typeof declaredBin === 'string') {
      const packageDirectory = hostPath.dirname(packageFile)
      const expected = hostPath.resolve(packageDirectory, declaredBin)
      const relative = hostPath.relative(packageDirectory, expected)
      if (!relative.startsWith('..') && !hostPath.isAbsolute(relative)) {
        const shim = process.platform === 'win32' ? resolveWindowsCmdShim(command, env) : null
        const target = shim
          ? (shim.prefixArgs[0] ?? shim.program)
          : request.agent === 'omp'
            ? (bunShimTarget(command) ?? command)
            : command
        const actualPath = realpathSync(target)
        const expectedPath = realpathSync(expected)
        if (
          process.platform === 'win32'
            ? actualPath.toLowerCase() === expectedPath.toLowerCase()
            : actualPath === expectedPath
        ) {
          return true
        }
      }
    }
  } catch {
    return false
  }
  return false
}

export async function verifyAgentBunOwnership(
  request: AgentInstallRequest,
  command: string,
  bun: string,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  const listing = await runProcess({
    program: bun,
    args: ['pm', 'ls', '--global'],
    env,
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024
  })
  if (listing.code !== 0 || listing.timedOut || listing.outputTruncated) {
    return false
  }
  const root = stripAnsiEscapeSequences(listing.stdout)
    .split(/\r?\n/)[0]
    ?.match(/^(.+) node_modules \(\d+(?: installed)?\)$/)?.[1]
  const hostPath = process.platform === 'win32' ? path.win32 : path.posix
  if (!root || !hostPath.isAbsolute(root)) {
    return false
  }
  const name = '@oh-my-pi/pi-coding-agent'
  return isAgentPackageExecutable(
    request,
    command,
    name,
    hostPath.join(root, 'node_modules', name, 'package.json'),
    env
  )
}

export function resolveAgentUpgradeTarget(
  request: AgentInstallRequest,
  packageName: string,
  env: NodeJS.ProcessEnv
): AgentUpgradeTarget | null {
  const executable = agentExecutable(request)
  if (!executable) {
    return null
  }
  const hostPath = process.platform === 'win32' ? path.win32 : path.posix
  const command = hostPath.isAbsolute(executable)
    ? executable
    : resolveCliCommands([executable], { pathEnv: env.PATH ?? env.Path }).get(executable)
  if (!command) {
    return null
  }
  try {
    if (process.platform !== 'win32' && /\/(Cellar|Caskroom)\//.test(realpathSync(command))) {
      return null
    }
  } catch {
    return null
  }
  const prefix =
    process.platform === 'win32'
      ? hostPath.dirname(command)
      : hostPath.dirname(hostPath.dirname(command))
  const packageFile = hostPath.join(
    prefix,
    ...(process.platform === 'win32' ? [] : ['lib']),
    'node_modules',
    packageName,
    'package.json'
  )
  if (isAgentPackageExecutable(request, command, packageName, packageFile, env)) {
    return { command, prefix }
  }
  const args = AGENT_UPGRADE_COMMANDS[request.agent]
  const name = hostPath.basename(command).replace(/\.(exe|cmd|bat)$/i, '')
  return args && name === TUI_AGENT_CONFIG[request.agent].detectCmd ? { command, args } : null
}
