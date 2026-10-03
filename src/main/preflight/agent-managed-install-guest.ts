import type { AgentInstallRequest } from '../../shared/agent-install-types'
import { AGENT_NPM_REGISTRIES } from '../../shared/agent-npm-registry'
import {
  AGENT_UPGRADE_COMMANDS,
  type AgentInstallProvider
} from '../../shared/agent-install-providers'
import { buildPosixCommandPathLookupScript } from '../../shared/posix-command-path-lookup'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import type { WslGuestEnvironment } from '../wsl/wsl-guest-environment'
import { agentExecutable } from './agent-upgrade-target'
import { reviewedGuestTargetGuard } from './agent-reviewed-target-guest'

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
const lookup = (command: string) =>
  buildPosixCommandPathLookupScript(
    { kind: 'literal', value: command },
    { skipWindowsMountDirs: true }
  )

export function buildGuestBunVersionCheck(): string[] {
  return [
    lookup('awk'),
    '[ -n "$resolved" ] || exit 127',
    '_orca_awk="$resolved"',
    '_orca_bun_version="$("$_orca_manager" --version)" || exit 127',
    'printf "%s\\n" "$_orca_bun_version" | "$_orca_awk" \'/^[0-9]+\\.[0-9]+\\.[0-9]+(\\+[0-9A-Za-z.-]+)?$/ { split($0,a,"."); valid=(a[1]+0>1 || (a[1]+0==1 && (a[2]+0>3 || (a[2]+0==3 && a[3]+0>=14)))) } END { exit !valid }\' || { printf "OMP requires Bun 1.3.14 or later\\n" >&2; exit 127; }'
  ]
}

export function buildManagedGuestInstallScript(
  request: AgentInstallRequest,
  provider: AgentInstallProvider,
  guest: WslGuestEnvironment,
  minimumVersion?: string
): string | null {
  const command = agentExecutable(request)
  if (!command) {
    return null
  }
  const upgrading = request.action === 'upgrade'
  const registry = AGENT_NPM_REGISTRIES[request.registry ?? 'default']
  const lines = [
    `PATH=${quote(guest.path)}; HOME=${quote(guest.home)}; export PATH HOME`,
    `npm_config_registry=${quote(registry)}; BUN_CONFIG_REGISTRY=${quote(registry)}; export npm_config_registry BUN_CONFIG_REGISTRY`,
    lookup('timeout'),
    '[ -n "$resolved" ] || exit 127',
    '_orca_timeout="$resolved"'
  ]
  if (upgrading) {
    lines.push(lookup(command), '[ -n "$resolved" ] || exit 125', '_orca_active="$resolved"')
    lines.push(...reviewedGuestTargetGuard(request))
  }
  if (provider.kind === 'binary') {
    const x64 = provider.urls['linux-x64']
    const arm64 = provider.urls['linux-arm64']
    if (!x64 || !arm64) {
      return null
    }
    lines.push(
      lookup('uname'),
      '[ -n "$resolved" ] || exit 127',
      '_orca_arch="$("$resolved" -m)"',
      `case "$_orca_arch" in x86_64) _orca_url=${quote(x64)} ;; aarch64|arm64) _orca_url=${quote(arm64)} ;; *) exit 126 ;; esac`
    )
    lines.push(
      upgrading ? '_orca_command="$_orca_active"' : '_orca_command="$HOME/.local/bin/acli"',
      'case "$_orca_command" in */acli) ;; *) exit 125 ;; esac',
      '_orca_bin="$(dirname "$_orca_command")"',
      'case ":$PATH:" in *":$_orca_bin:"*) ;; *) printf "The tool bin directory must be on PATH: %s\\n" "$_orca_bin" >&2; exit 126 ;; esac',
      lookup('awk'),
      '[ -n "$resolved" ] || exit 127',
      '_orca_awk="$resolved"',
      'mkdir -p "$_orca_bin" || exit 126',
      lookup('curl'),
      '[ -n "$resolved" ] || exit 127',
      '_orca_curl="$resolved"',
      '_orca_tmp="$(mktemp "$_orca_bin/.hive-acli.XXXXXX")" || exit 126',
      'trap \'rm -f "$_orca_tmp"\' EXIT HUP INT TERM',
      '"$_orca_curl" --proto =https --proto-redir =https --fail --silent --show-error --location --max-time 30 --max-filesize 134217728 "$_orca_url" --output "$_orca_tmp" || exit $?',
      'chmod 755 "$_orca_tmp" || exit 126',
      '_orca_candidate_output="$("$_orca_timeout" --kill-after=2s 5s "$_orca_tmp" --version)" || exit 126',
      `printf "%s\\n" "$_orca_candidate_output" | "$_orca_awk" -v required=${quote(minimumVersion ?? '0.0.0')} 'match($0, /[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?/) { v=substr($0,RSTART,RLENGTH); if(v !~ /^[0-9]+\\.[0-9]+\\.[0-9]+$/) exit 1; split(v,a,"."); split(required,b,"."); for(i=1;i<=3;i++) { if(a[i]+0>b[i]+0) { valid=1; exit }; if(a[i]+0<b[i]+0) exit 1 }; valid=1; exit } END { exit !valid }' || exit 126`,
      ...reviewedGuestTargetGuard(request),
      'mv -f "$_orca_tmp" "$_orca_command" || exit 126',
      'printf "\\n__HIVE_AGENT_COMMAND__%s\\n" "$_orca_command"'
    )
  } else if (provider.kind === 'script') {
    if (upgrading) {
      const args = AGENT_UPGRADE_COMMANDS[request.agent]
      if (!args) {
        return null
      }
      lines.push(
        'PATH="$(dirname "$_orca_active"):$PATH"; export PATH',
        `"$_orca_timeout" --kill-after=5s 110s "$_orca_active" ${args.map(quote).join(' ')} || exit $?`,
        'printf "\\n__HIVE_AGENT_COMMAND__%s\\n" "$_orca_active"'
      )
    } else {
      if (!provider.posixUrl) {
        return null
      }
      for (const [key, value] of Object.entries(provider.env ?? {})) {
        lines.push(`${key}=${quote(value)}; export ${key}`)
      }
      lines.push(
        lookup('curl'),
        '[ -n "$resolved" ] || exit 127',
        '_orca_curl="$resolved"',
        lookup('bash'),
        '[ -n "$resolved" ] || exit 127',
        '_orca_bash="$resolved"',
        '_orca_tmp="$(mktemp)" || exit 126',
        'trap \'rm -f "$_orca_tmp"\' EXIT HUP INT TERM',
        `"$_orca_curl" --proto =https --proto-redir =https --fail --silent --show-error --location --max-time 15 --max-filesize 1048576 ${quote(provider.posixUrl)} --output "$_orca_tmp" || exit $?`,
        `"$_orca_timeout" --kill-after=5s 95s "$_orca_bash" "$_orca_tmp" ${(provider.posixArgs ?? []).map(quote).join(' ')} || exit $?`
      )
    }
  } else if (provider.kind === 'bun' || provider.kind === 'uv') {
    lines.push(lookup(provider.kind), '[ -n "$resolved" ] || exit 127', '_orca_manager="$resolved"')
    if (provider.kind === 'bun') {
      lines.push(...buildGuestBunVersionCheck())
    }
    lines.push(
      provider.kind === 'bun'
        ? '_orca_bin="$("$_orca_manager" pm bin --global)" || exit 127'
        : '_orca_bin="$("$_orca_manager" tool dir --bin)" || exit 127'
    )
    lines.push(
      'case "$_orca_bin" in /*) ;; *) exit 126 ;; esac',
      'case ":$PATH:" in *":$_orca_bin:"*) ;; *) printf "The tool bin directory must be on PATH: %s\\n" "$_orca_bin" >&2; exit 126 ;; esac'
    )
    if (upgrading) {
      lines.push('[ "$(dirname "$_orca_active")" = "$_orca_bin" ] || exit 125')
      if (provider.kind === 'bun') {
        const proof =
          'const fs=require("fs"),path=require("path");const [root,name,cmd,active]=process.argv.slice(1);const file=path.join(root,"node_modules",name,"package.json"),p=require(file),bin=typeof p.bin==="string"?p.bin:p.bin?.[cmd];if(p.name!==name||typeof bin!=="string")process.exit(1);const base=path.dirname(file),target=path.resolve(base,bin),relative=path.relative(base,target);if(relative.startsWith("..")||path.isAbsolute(relative)||fs.realpathSync(active)!==fs.realpathSync(target))process.exit(1);'
        lines.push(
          '_orca_listing="$("$_orca_manager" pm ls --global)" || exit 125',
          '_orca_root="${_orca_listing%% node_modules (*}"',
          'case "$_orca_root" in /*) ;; *) exit 125 ;; esac',
          `"$_orca_manager" -e ${quote(proof)} "$_orca_root" ${quote(provider.packageName)} ${quote(TUI_AGENT_CONFIG[request.agent].detectCmd)} "$_orca_active" || exit 125`
        )
      }
    }
    const args =
      provider.kind === 'bun'
        ? ['add', '--global', `${provider.packageName}@latest`, '--registry', registry]
        : upgrading
          ? ['tool', 'upgrade', provider.packageName]
          : ['tool', 'install', '--python', '3.12', '--with', 'pip', provider.packageName]
    lines.push(
      ...reviewedGuestTargetGuard(request),
      `"$_orca_timeout" --kill-after=5s 110s "$_orca_manager" ${args.map(quote).join(' ')} || exit $?`,
      lookup(upgrading ? command : TUI_AGENT_CONFIG[request.agent].detectCmd),
      '[ -n "$resolved" ] || exit 126',
      '[ "$(dirname "$resolved")" = "$_orca_bin" ] || exit 126'
    )
    if (upgrading) {
      lines.push('[ "$resolved" = "$_orca_active" ] || exit 125')
    }
    lines.push('printf "\\n__HIVE_AGENT_COMMAND__%s\\n" "$resolved"')
  } else {
    return null
  }
  return lines.join('\n')
}
