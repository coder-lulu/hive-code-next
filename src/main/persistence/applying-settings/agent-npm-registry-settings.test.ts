import { describe, expect, it, vi } from 'vitest'
import { createGlobalSettingsFixture } from '../../../shared/global-settings-test-fixture'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { updateSettings, type SettingsMutationOperations } from './settings-update'
import { RuntimeClientSettingsController } from '../../runtime/runtime-client-settings'
import { SettingsUpdate } from '../../../shared/rpc-contract/client-settings-params'

function operations(): SettingsMutationOperations {
  return {
    state: {
      settings: createGlobalSettingsFixture({ workspaceDir: '/w' }),
      repos: []
    } as unknown as PersistedState,
    bumpLocalWorktreeScanGeneration: vi.fn(),
    removeRetainedBlob: vi.fn(),
    scheduleSave: vi.fn(),
    notifySettingsChanged: vi.fn()
  }
}

describe('agent npm registry settings across local and paired clients', () => {
  it('persists switching in both directions and preserves the source on unrelated writes', () => {
    const ops = operations()
    expect(updateSettings(ops, { agentNpmRegistry: 'china' }).agentNpmRegistry).toBe('china')
    expect(updateSettings(ops, { terminalFontSize: 16 }).agentNpmRegistry).toBe('china')
    expect(updateSettings(ops, { agentNpmRegistry: 'default' }).agentNpmRegistry).toBe('default')
    expect(ops.scheduleSave).toHaveBeenCalled()
  })

  it('sanitizes values written outside the typed UI without accepting arbitrary sources', () => {
    const ops = operations()
    expect(
      updateSettings(ops, { agentNpmRegistry: 'https://untrusted.invalid' as never })
        .agentNpmRegistry
    ).toBe('default')
    expect(
      SettingsUpdate.safeParse({ agentNpmRegistry: 'https://untrusted.invalid' }).success
    ).toBe(false)
    expect(SettingsUpdate.safeParse({ agentNpmRegistry: 'china' }).success).toBe(true)
  })

  it('projects and updates the executing host source for paired clients', async () => {
    const ops = operations()
    const store = {
      getSettings: () => ops.state.settings,
      updateSettings: (value: Parameters<typeof updateSettings>[1]) => updateSettings(ops, value)
    }
    const controller = new RuntimeClientSettingsController(store as never)
    expect(controller.get().agentNpmRegistry).toBe('default')
    expect((await controller.update({ agentNpmRegistry: 'china' })).agentNpmRegistry).toBe('china')
    expect(ops.state.settings.agentNpmRegistry).toBe('china')
  })
})
