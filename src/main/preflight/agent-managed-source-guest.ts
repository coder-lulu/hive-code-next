import { AGENT_INSTALL_PROVIDERS } from '../../shared/agent-install-providers'
import type { TuiAgent } from '../../shared/tui-agent'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { buildPosixCommandPathLookupScript } from '../../shared/posix-command-path-lookup'
import { quoteStartupArg } from '../../shared/tui-agent-startup-shell'
import { GUEST_NPM_OWNERSHIP_PROOF } from './agent-npm-ownership-proof'

export function guestManagedSourceSetup(agent: TuiAgent): string[] {
  const provider = AGENT_INSTALL_PROVIDERS[agent]
  if (provider?.kind !== 'bun' && provider?.kind !== 'uv') {
    return []
  }
  return [
    buildPosixCommandPathLookupScript(
      { kind: 'literal', value: provider.kind },
      { skipWindowsMountDirs: true }
    ),
    '_hive_manager="$resolved"; _hive_bin=; _hive_root=',
    'if [ -n "$_hive_manager" ]; then',
    provider.kind === 'uv'
      ? '  _hive_bin="$("$_hive_manager" tool dir --bin 2>/dev/null)" || _hive_bin='
      : '  _hive_bin="$("$_hive_manager" pm bin --global 2>/dev/null)" || _hive_bin=',
    ...(provider.kind === 'bun'
      ? [
          '  _hive_listing="$("$_hive_manager" pm ls --global 2>/dev/null)" || _hive_bin=',
          '  _hive_root="${_hive_listing%% node_modules (*}"'
        ]
      : []),
    'fi'
  ]
}

export function guestManagedSourceProbe(agent: TuiAgent): string[] {
  const provider = AGENT_INSTALL_PROVIDERS[agent]
  const command = TUI_AGENT_CONFIG[agent].detectCmd
  if (provider?.kind === 'binary') {
    return [`  case "$_hive_path" in */${command}) _hive_source=binary ;; esac`]
  }
  if (provider?.kind !== 'bun' && provider?.kind !== 'uv') {
    return []
  }
  const quote = (value: string) => quoteStartupArg(value, 'posix')
  return [
    '  if [ -n "$_hive_bin" ] && [ "$(dirname "$_hive_path")" = "$_hive_bin" ]; then',
    ...(provider.kind === 'uv'
      ? ['    _hive_source=uv']
      : [
          `    if "$_hive_manager" -e ${quote(GUEST_NPM_OWNERSHIP_PROOF)} "$_hive_root/node_modules/${provider.packageName}/package.json" ${quote(provider.packageName)} ${quote(command)} "$_hive_path" 2>/dev/null; then _hive_source=bun; fi`
        ]),
    '  fi'
  ]
}
