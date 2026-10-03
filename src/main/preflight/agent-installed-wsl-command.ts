import type { TuiAgent } from '../../shared/tui-agent'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { buildPosixCommandPathLookupScript } from '../../shared/posix-command-path-lookup'
import { getWslGuestEnvironment, invalidateWslGuestEnvironment } from '../wsl/wsl-guest-environment'
import { runWslProcess } from '../wsl/wsl-runner'

export async function resolveInstalledWslAgent(
  agent: TuiAgent,
  distro: string
): Promise<string | undefined> {
  invalidateWslGuestEnvironment(distro)
  const guest = await getWslGuestEnvironment(distro)
  if (!guest) {
    throw new Error('environment-unverifiable')
  }
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
  const resolved = await runWslProcess({
    distro,
    loginPath: 'none',
    timeoutMs: 10_000,
    maxOutputBytes: 4096,
    script: [
      `PATH=${quote(guest.path)}; export PATH`,
      buildPosixCommandPathLookupScript(
        { kind: 'literal', value: TUI_AGENT_CONFIG[agent].detectCmd },
        { skipWindowsMountDirs: true }
      ),
      '[ -n "$resolved" ] || exit 126',
      'printf "%s" "$resolved"'
    ].join('\n')
  })
  return resolved.code === 0 && !resolved.timedOut ? resolved.stdout.trim() : undefined
}
