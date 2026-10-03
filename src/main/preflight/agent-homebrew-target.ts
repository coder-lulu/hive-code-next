import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { TuiAgent } from '../../shared/tui-agent'
import { runProcess } from '../../shared/child-process/run-process'
import { versionFromOutput } from './agent-version-output'

const PACKAGES: Partial<Record<TuiAgent, string>> = {
  claude: 'claude-code',
  codex: 'codex',
  gemini: 'gemini-cli',
  opencode: 'opencode'
}

export function isHomebrewManagedPath(realPath: string): boolean {
  return path.posix.isAbsolute(realPath) && /\/(Cellar|Caskroom)\//.test(realPath)
}

export type AgentHomebrewTarget = {
  program: string
  kind: 'formula' | 'cask'
  packageName: string
  installedVersion: string
}

export function homebrewTargetFromPath(
  agent: TuiAgent,
  realPath: string
): AgentHomebrewTarget | null {
  const match = realPath.match(/^(.*)\/(Cellar|Caskroom)\/([^/]+)\/([^/]+)\//)
  if (!match || !path.posix.isAbsolute(realPath) || PACKAGES[agent] !== match[3]) {
    return null
  }
  return {
    program: path.posix.join(match[1], 'bin', 'brew'),
    kind: match[2] === 'Cellar' ? 'formula' : 'cask',
    packageName: match[3],
    installedVersion: match[4]
  }
}

export function resolveAgentHomebrewTarget(
  agent: TuiAgent,
  command: string
): AgentHomebrewTarget | null {
  if (process.platform === 'win32') {
    return null
  }
  try {
    return homebrewTargetFromPath(agent, realpathSync(command))
  } catch {
    return null
  }
}

export async function readHomebrewTargetVersion(
  target: AgentHomebrewTarget,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  const result = await runProcess({
    program: target.program,
    args: ['info', '--json=v2', `--${target.kind}`, target.packageName],
    env: { ...env, HOMEBREW_NO_AUTO_UPDATE: '1' },
    timeoutMs: 15_000,
    maxOutputBytes: 256 * 1024
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    return null
  }
  try {
    const metadata = JSON.parse(result.stdout)
    const entries = target.kind === 'formula' ? metadata.formulae : metadata.casks
    if (!Array.isArray(entries)) {
      return null
    }
    const entry = entries.find(
      (item) => (target.kind === 'formula' ? item.name : item.token) === target.packageName
    )
    if (!entry) {
      return null
    }
    const installed =
      target.kind === 'formula'
        ? entry.installed?.some(
            (item: { version?: string }) => item.version === target.installedVersion
          )
        : entry.installed === target.installedVersion
    const latest = target.kind === 'formula' ? entry.versions?.stable : entry.version
    return installed && typeof latest === 'string' ? versionFromOutput(latest, '') : null
  } catch {
    return null
  }
}
