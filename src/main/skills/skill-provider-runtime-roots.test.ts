import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveEnvironmentSkillProviderRoots,
  resolveWslGrokSkillProviderRoot,
  withClaudeSkillProviderRoot
} from './skill-provider-runtime-roots'

describe('skill provider runtime roots', () => {
  it('maps Claude and Grok config homes to their global skill roots', () => {
    const claudeConfig = resolve('/srv', 'claude')
    const grokHome = resolve('/srv', 'grok')
    expect(
      resolveEnvironmentSkillProviderRoots({
        CLAUDE_CONFIG_DIR: claudeConfig,
        GROK_HOME: grokHome
      })
    ).toEqual({
      claude: join(claudeConfig, 'skills'),
      grok: join(grokHome, 'skills')
    })
  })

  it('rejects relative config roots and lets a target-specific Claude root win', () => {
    const roots = resolveEnvironmentSkillProviderRoots({
      CLAUDE_CONFIG_DIR: '../claude',
      GROK_HOME: '../grok'
    })
    expect(roots).toEqual({})
    const managedClaudeConfig = resolve('/managed', 'claude')
    expect(withClaudeSkillProviderRoot(roots, managedClaudeConfig)).toEqual({
      claude: join(managedClaudeConfig, 'skills')
    })
  })

  it('maps the WSL login shell GROK_HOME to a host-readable skill root', async () => {
    await expect(
      resolveWslGrokSkillProviderRoot('Ubuntu-24.04', async () => '/srv/grok\n')
    ).resolves.toBe('\\\\wsl.localhost\\Ubuntu-24.04\\srv\\grok\\skills')
  })

  it('ignores unsafe or missing WSL GROK_HOME values', async () => {
    await expect(
      resolveWslGrokSkillProviderRoot('Ubuntu', async () => '../grok')
    ).resolves.toBeNull()
    await expect(
      resolveWslGrokSkillProviderRoot('Ubuntu', async () => '/srv/grok\0other')
    ).resolves.toBeNull()
    await expect(
      resolveWslGrokSkillProviderRoot('Ubuntu', async () => {
        throw new Error('probe failed')
      })
    ).resolves.toBeNull()
  })
})
