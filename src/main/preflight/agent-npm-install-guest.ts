import type { AgentInstallRequest } from '../../shared/agent-install-types'
import { AGENT_NPM_REGISTRIES } from '../../shared/agent-npm-registry'
import { AGENT_UPGRADE_COMMANDS } from '../../shared/agent-install-providers'
import { buildPosixCommandPathLookupScript } from '../../shared/posix-command-path-lookup'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import type { WslGuestEnvironment } from '../wsl/wsl-guest-environment'
import { agentExecutable } from './agent-upgrade-target'
import { GUEST_NPM_OWNERSHIP_PROOF } from './agent-npm-ownership-proof'
import { reviewedGuestTargetGuard } from './agent-reviewed-target-guest'
import {
  buildGuestBunVersionCheck,
  buildManagedGuestInstallScript
} from './agent-managed-install-guest'

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
const lookup = (command: string) =>
  buildPosixCommandPathLookupScript(
    { kind: 'literal', value: command },
    { skipWindowsMountDirs: true }
  )

export function buildNpmGuestInstallScript(
  request: AgentInstallRequest,
  packageName: string,
  guest: WslGuestEnvironment
): string {
  const registry = AGENT_NPM_REGISTRIES[request.registry ?? 'default']
  const lines = [
    `PATH=${quote(guest.path)}; HOME=${quote(guest.home)}; npm_config_registry=${quote(registry)}; BUN_CONFIG_REGISTRY=${quote(registry)}; export PATH HOME npm_config_registry BUN_CONFIG_REGISTRY`,
    lookup('timeout'),
    '[ -n "$resolved" ] || exit 127',
    '_orca_timeout="$resolved"',
    lookup('node'),
    '_orca_node="$resolved"'
  ]
  if (request.action === 'upgrade') {
    lines.push(
      lookup(agentExecutable(request) ?? ''),
      '[ -n "$resolved" ] || exit 125',
      '_orca_active="$resolved"',
      ...reviewedGuestTargetGuard(request),
      'PATH="$(dirname "$_orca_active"):$PATH"; export PATH',
      lookup('node'),
      '_orca_node="$resolved"',
      '_orca_prefix="$(dirname "$(dirname "$_orca_active")")"'
    )
    const proof = GUEST_NPM_OWNERSHIP_PROOF
    lines.push(
      `if [ -z "$_orca_node" ] || ! "$_orca_node" -e ${quote(proof)} "$_orca_prefix/lib/node_modules/${packageName}/package.json" ${quote(packageName)} ${quote(TUI_AGENT_CONFIG[request.agent].detectCmd)} "$_orca_active"; then`
    )
    const args = AGENT_UPGRADE_COMMANDS[request.agent]
    const bunUpgrade =
      request.agent === 'omp'
        ? buildManagedGuestInstallScript(request, { kind: 'bun', packageName }, guest)
        : null
    lines.push(
      bunUpgrade
        ? `${bunUpgrade}\nexit 0`
        : args
          ? `  PATH="$(dirname "$_orca_active"):$PATH"; export PATH\n  "$_orca_timeout" --kill-after=5s 110s "$_orca_active" ${args.map(quote).join(' ')} || exit $?\n  printf "\\n__HIVE_AGENT_COMMAND__%s\\n" "$_orca_active"\n  exit 0`
          : '  exit 125'
    )
    lines.push('fi')
  }
  if (request.agent === 'omp') {
    lines.push(
      lookup('bun'),
      '[ -n "$resolved" ] || exit 127',
      '_orca_manager="$resolved"',
      ...buildGuestBunVersionCheck()
    )
  }
  lines.push(
    '[ -n "$_orca_node" ] || exit 127',
    '"$_orca_node" --version >/dev/null || exit 127',
    lookup('npm'),
    '[ -n "$resolved" ] || exit 127',
    '_orca_npm="$resolved"'
  )
  if (request.action !== 'upgrade') {
    lines.push('_orca_prefix="$("$_orca_npm" prefix --global)" || exit 127')
  }
  lines.push(
    'case "$_orca_prefix" in /*) ;; *) exit 127 ;; esac',
    'case ":$PATH:" in *":$_orca_prefix/bin:"*) ;; *) printf "npm global bin directory must be on PATH: %s/bin\\n" "$_orca_prefix" >&2; exit 126 ;; esac',
    ...reviewedGuestTargetGuard(request),
    `"$_orca_timeout" --kill-after=5s 110s "$_orca_npm" install --global ${quote(`${packageName}@latest`)} --prefix "$_orca_prefix" --registry ${quote(registry)} --no-fund --no-audit --engine-strict || exit $?`,
    'printf "\\n__HIVE_AGENT_INSTALL_PREFIX__%s\\n" "$_orca_prefix"'
  )
  return lines.join('\n')
}
