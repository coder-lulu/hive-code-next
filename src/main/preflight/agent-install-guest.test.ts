import { describe, expect, it } from 'vitest'
import { buildNpmGuestInstallScript } from './agent-npm-install-guest'
import { buildManagedGuestInstallScript } from './agent-managed-install-guest'
import { AGENT_INSTALL_PROVIDERS } from '../../shared/agent-install-providers'
import { buildAgentInstallationsGuestScript } from './agent-installations-guest'

const guest = {
  home: '/home/user',
  path: '/home/user/custom/bin:/usr/bin',
  envBinary: '/usr/bin/env'
}

describe('agent lifecycle guest boundaries', () => {
  it.each(['aider', 'rovo'] as const)(
    'rechecks %s identity immediately before guest mutation',
    (agent) => {
      const script = buildManagedGuestInstallScript(
        {
          agent,
          action: 'upgrade',
          commandOverride: `/tools/${agent}`,
          expectedRealPath: '/reviewed/target'
        },
        AGENT_INSTALL_PROVIDERS[agent]!,
        guest
      )!
      const guard = script.lastIndexOf('readlink -f')
      const preparation = script.indexOf(
        agent === 'rovo' ? '_orca_candidate_output=' : '_orca_bin='
      )
      const mutation = script.indexOf(agent === 'rovo' ? 'mv -f' : '110s "$_orca_manager"')
      expect(guard).toBeGreaterThan(preparation)
      expect(guard).toBeLessThan(mutation)
    }
  )
  it.each(['aider', 'omp'] as const)(
    'verifies the selected %s guest installation even when PATH prefers another copy',
    (agent) => {
      const command = `/home/user/managed/${agent}`
      const script = buildManagedGuestInstallScript(
        { agent, action: 'upgrade', commandOverride: command },
        AGENT_INSTALL_PROVIDERS[agent]!,
        guest
      )!
      const afterMutation = script.slice(script.indexOf('110s "$_orca_manager"'))
      expect(afterMutation).toContain(`_orca_lookup_command='${command}'`)
      expect(afterMutation).not.toContain(`_orca_lookup_command='${agent}'`)
    }
  )
  it('keeps managed guest inventory tied to the owning manager', () => {
    const bun = buildAgentInstallationsGuestScript({ agent: 'omp' }, guest)
    expect(bun).toContain('pm bin --global')
    expect(bun).toContain('pm ls --global')
    expect(bun).toContain('fs.realpathSync(active)!==fs.realpathSync(target)')
    expect(bun).not.toContain('_hive_source=self-update')
    const uv = buildAgentInstallationsGuestScript({ agent: 'aider' }, guest)
    expect(uv).toContain('tool dir --bin')
    expect(uv).toContain('[ "$(dirname "$_hive_path")" = "$_hive_bin" ]')
    expect(uv).toContain('_hive_source=uv')
  })
  it('checks a reviewed real path before any guest installation mutation', () => {
    const script = buildNpmGuestInstallScript(
      { agent: 'codex', action: 'upgrade', expectedRealPath: '/home/user/reviewed/codex' },
      '@openai/codex',
      guest
    )
    expect(script).toContain(
      '[ "$_hive_reviewed_real" = \'/home/user/reviewed/codex\' ] || exit 123'
    )
    expect(script.indexOf('readlink -f')).toBeLessThan(script.indexOf('"$_orca_npm" install'))
    expect(script).toContain('PATH="$(dirname "$_orca_active"):$PATH"; export PATH')
  })
  it('upgrades a proven active npm prefix without consulting another default prefix', () => {
    const script = buildNpmGuestInstallScript(
      {
        agent: 'codex',
        action: 'upgrade',
        registry: 'china',
        commandOverride: '/home/user/custom/bin/codex'
      },
      '@openai/codex',
      guest
    )
    expect(script).not.toContain('prefix --global')
    expect(script).toContain('fs.realpathSync(active)!==fs.realpathSync(target)')
    expect(script.indexOf('fs.realpathSync(active)')).toBeLessThan(
      script.indexOf('npm global bin directory must be on PATH')
    )
    expect(script.indexOf('npm global bin directory must be on PATH')).toBeLessThan(
      script.indexOf('install --global')
    )
    expect(script).toContain(
      '--prefix "$_orca_prefix" --registry \'https://registry.npmmirror.com\''
    )
  })

  it('keeps native updaters on the selected executable rather than another PATH copy', () => {
    const script = buildNpmGuestInstallScript(
      { agent: 'grok', action: 'upgrade', commandOverride: '/home/user/custom/bin/grok' },
      '@xai-official/grok',
      guest
    )
    expect(script).toContain('PATH="$(dirname "$_orca_active"):$PATH"; export PATH')
    expect(script).toContain('110s "$_orca_active" \'update\'')
    expect(script).toContain('drvfs')
  })

  it('uses source-controlled Bun for non-npm OMP and checks the active bin before mutation', () => {
    const script = buildNpmGuestInstallScript(
      { agent: 'omp', action: 'upgrade', registry: 'china' },
      '@oh-my-pi/pi-coding-agent',
      guest
    )
    expect(script).toContain('pm bin --global')
    expect(script).toContain('pm ls --global')
    expect(script).toContain('fs.realpathSync(active)!==fs.realpathSync(target)')
    expect(script).toContain('[ "$(dirname "$_orca_active")" = "$_orca_bin" ] || exit 125')
    expect(script).toContain(
      "'@oh-my-pi/pi-coding-agent@latest' '--registry' 'https://registry.npmmirror.com'"
    )
    expect(script).not.toContain('110s "$_orca_active" \'update\'')
    expect(script.slice(script.lastIndexOf('\nfi\n'))).toContain('OMP requires Bun 1.3.14 or later')
    expect(script.lastIndexOf('OMP requires Bun 1.3.14 or later')).toBeLessThan(
      script.indexOf('"$_orca_npm" install')
    )
  })

  it('protects a current binary with a candidate-version check before replacement', () => {
    const script = buildManagedGuestInstallScript(
      { agent: 'rovo', action: 'upgrade' },
      AGENT_INSTALL_PROVIDERS.rovo!,
      guest,
      '2.3.4'
    )!
    expect(script).toContain("required='2.3.4'")
    expect(script.indexOf('_orca_candidate_output=')).toBeLessThan(script.indexOf('mv -f'))
    expect(script.indexOf('END { exit !valid }')).toBeLessThan(script.indexOf('mv -f'))
    expect(script).toContain('--proto =https --proto-redir =https')
    expect(script).toContain('--max-filesize 134217728')
    expect(script).toContain('"$_orca_command"')
  })

  it('runs Hermes unattended without invoking setup after installing the official script', () => {
    const script = buildManagedGuestInstallScript(
      { agent: 'hermes' },
      AGENT_INSTALL_PROVIDERS.hermes!,
      guest
    )!
    expect(script).toContain("'--skip-setup' '--non-interactive'")
    expect(script).toContain('--max-time 15 --max-filesize 1048576')
    expect(script).toContain('--kill-after=5s 95s')
  })
})
