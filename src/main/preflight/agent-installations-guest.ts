import type { AgentInstallationRequest } from '../../shared/agent-installation-types'
import { NPM_AGENT_PACKAGES } from '../../shared/agent-install-types'
import {
  AGENT_INSTALL_PROVIDERS,
  AGENT_UPGRADE_COMMANDS
} from '../../shared/agent-install-providers'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { buildPosixCommandPathLookupScript } from '../../shared/posix-command-path-lookup'
import { quoteStartupArg } from '../../shared/tui-agent-startup-shell'
import type { WslGuestEnvironment } from '../wsl/wsl-guest-environment'
import { GUEST_NPM_OWNERSHIP_PROOF } from './agent-npm-ownership-proof'
import { guestManagedSourceSetup, guestManagedSourceProbe } from './agent-managed-source-guest'
import { agentExecutable } from './agent-upgrade-target'

export function buildAgentInstallationsGuestScript(
  request: AgentInstallationRequest,
  guest: WslGuestEnvironment
): string {
  const quote = (value: string) => quoteStartupArg(value, 'posix')
  const command = TUI_AGENT_CONFIG[request.agent].detectCmd
  const lookup = (value: string) =>
    buildPosixCommandPathLookupScript({ kind: 'literal', value }, { skipWindowsMountDirs: true })
  const executable = agentExecutable(request) ?? command
  const packageName = NPM_AGENT_PACKAGES[request.agent]
  return [
    `PATH=${quote(guest.path)}; HOME=${quote(guest.home)}; export PATH HOME`,
    'set -f',
    lookup(command),
    '_hive_default="$resolved"',
    lookup(executable),
    '_hive_active="$resolved"',
    lookup('node'),
    '_hive_node="$resolved"',
    ...guestManagedSourceSetup(request.agent),
    'command -v readlink >/dev/null || exit 127',
    `printf '__HIVE_INSTALLATIONS__\\0%s\\0%s\\0' "$_hive_default" "$_hive_active"`,
    `set -- "$_hive_active"`,
    '_hive_dirs="$PATH:$HOME/.local/bin:$HOME/.bun/bin:$HOME/.opencode/bin"',
    '_hive_ifs="$IFS"; IFS=:',
    'for _hive_dir in $_hive_dirs; do',
    '  case "$_hive_dir" in /*) ;; *) continue ;; esac',
    '  IFS="$_hive_ifs"; _hive_skip=false; for _hive_mount in $_orca_win_mounts; do',
    '    case "$_hive_dir/" in "$_hive_mount"/*) _hive_skip=true ;; esac',
    '  done; IFS=:',
    '  [ "$_hive_skip" = false ] || continue',
    `  set -- "$@" "$_hive_dir/${command}"`,
    'done; IFS="$_hive_ifs"',
    '_hive_count=0',
    'for _hive_path do',
    '  [ -f "$_hive_path" ] || [ -L "$_hive_path" ] || continue',
    '  _hive_count=$((_hive_count + 1)); [ "$_hive_count" -le 64 ] || break',
    '  _hive_real="$(readlink -f -- "$_hive_path")" || _hive_real="$_hive_path"',
    '  _hive_source=unknown',
    ...(!['bun', 'uv', 'binary'].includes(AGENT_INSTALL_PROVIDERS[request.agent]?.kind ?? '') &&
    AGENT_UPGRADE_COMMANDS[request.agent]
      ? [`  case "$_hive_path" in */${command}) _hive_source=self-update ;; esac`]
      : []),
    ...(packageName
      ? [
          '  _hive_prefix="$(dirname "$(dirname "$_hive_path")")"',
          '  _hive_probe_node="$_hive_node"; _hive_sibling_node="${_hive_path%/*}/node"',
          '  if [ -x "$_hive_sibling_node" ] && [ ! -d "$_hive_sibling_node" ]; then _hive_probe_node="$_hive_sibling_node"; fi',
          `  if [ -n "$_hive_probe_node" ] && "$_hive_probe_node" -e ${quote(GUEST_NPM_OWNERSHIP_PROOF)} "$_hive_prefix/lib/node_modules/${packageName}/package.json" ${quote(packageName)} ${quote(command)} "$_hive_path" 2>/dev/null; then _hive_source=npm; fi`
        ]
      : []),
    ...guestManagedSourceProbe(request.agent),
    '  case "$_hive_real" in */Cellar/*|*/Caskroom/*) _hive_source=unknown ;; esac',
    '  printf "%s\\0%s\\0%s\\0" "$_hive_path" "$_hive_real" "$_hive_source"',
    'done'
  ].join('\n')
}
