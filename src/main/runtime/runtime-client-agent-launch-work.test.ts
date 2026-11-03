import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeClientSettingsController } from './runtime-client-settings'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import {
  measureSettingsWork,
  expectSettingsWorkScale
} from '../../shared/agent-launch-settings-work.test-helper'
import { AgentLaunchSettingsMutation } from '../../shared/rpc-contract/agent-launch-settings-params'
import * as profile from '../../shared/agent-launch-profile'
import * as shell from '../../shared/tui-agent-startup-shell'
import type { RuntimeStore } from './runtime-store-contract'
vi.mock('../agent-hooks/managed-agent-hook-controls', () => ({
  applyAgentStatusHooksEnabled: vi.fn(async () => {})
}))
afterEach(() => vi.restoreAllMocks())
it.each([20, 200])(
  'keeps current host reads and typed/raw writes bounded for %s entries',
  async (n) => {
    const settings = createGlobalSettingsFixture({
      agentPermissionDefault: 'ask',
      agentDefaultArgs: { claude: '--model opus '.repeat(n) },
      agentDefaultEnv: {
        claude: Object.fromEntries(Array.from({ length: n }, (_, i) => [`K${i}`, 'private']))
      }
    })
    const durable: NonNullable<RuntimeStore['runDurableMutation']> = async (mutate) =>
      mutate().value
    const controller = new RuntimeClientSettingsController({
      getSettings: () => settings,
      updateSettings: (updates) => Object.assign(settings, updates),
      runDurableMutation: durable
    })
    const composed = vi.spyOn(profile, 'projectAgentLaunchProfile')
    const tokenized = vi.spyOn(shell, 'tokenizeStartupCommand')
    for (const [key, call] of [
      ['read', () => controller.getAgentLaunch()],
      [
        'typed',
        () =>
          controller.mutateAgentLaunch(
            AgentLaunchSettingsMutation.parse({ type: 'permissions', agent: 'claude', mode: 'ask' })
          )
      ],
      [
        'raw',
        () =>
          controller.update({
            agentDefaultArgs: {
              claude: `--permission-mode auto ${settings.agentDefaultArgs?.claude ?? ''}`
            }
          })
      ],
      [
        'reset',
        () =>
          controller.mutateAgentLaunch(
            AgentLaunchSettingsMutation.parse({
              type: 'permissions',
              agent: 'claude',
              mode: 'default'
            })
          )
      ]
    ] as const) {
      const measured = measureSettingsWork(() => call())
      const result = await measured.value
      const { work } = measured
      expect(composed).not.toHaveBeenCalled()
      expect(tokenized).not.toHaveBeenCalled()
      expect(work.entries + work.visits).toBeLessThanOrEqual(40 * n + 8000)
      expect(work.comparisons).toBeLessThanOrEqual(4 * (n + 1) * Math.ceil(Math.log2(n + 1)))
      expectSettingsWorkScale(key, n, [
        work.entries + work.visits,
        JSON.stringify(result).length + work.bytes
      ])
      expect(settings.agentPermissionDefault).toBe('ask')
      expect(settings.agentPermissionOverrides?.claude).toBe(
        key === 'typed' || key === 'raw' ? 'ask' : undefined
      )
      if (key !== 'raw') {
        expect(JSON.stringify(result)).not.toContain('private')
      }
    }
  }
)
