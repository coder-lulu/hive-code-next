import { isValidAppVersion } from '../../shared/app-version'
import { stripAnsiEscapeSequences } from '../../shared/ansi-escape-sequences'
import { tokenizeStartupCommand } from '../../shared/tui-agent-startup-shell'

export function singleExecutable(command: string, windowsHost: boolean): string | null {
  // Shell constructs are unsupported; version checks never evaluate override source.
  if (/[;&|<>$`\r\n\0]/.test(command)) {
    return null
  }
  const parsed = tokenizeStartupCommand(command, windowsHost ? 'powershell' : 'posix')
  return parsed.ok && parsed.tokens.length === 1 ? parsed.tokens[0] : null
}

export function versionFromOutput(stdout: string, stderr: string): string | null {
  for (const line of stripAnsiEscapeSequences(`${stdout}\n${stderr}`).split(/\r?\n/)) {
    const match = line
      .trim()
      .match(
        /^(?:[A-Za-z][\w .-]*(?:\s+|\/))?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\s+\([^)]+\))?$/
      )
    if (match && match[1].length <= 128 && isValidAppVersion(match[1])) {
      return match[1]
    }
  }
  return null
}
