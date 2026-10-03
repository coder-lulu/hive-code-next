import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, testState } from './persistence-test-harness'
import { buildHeadlessMobileSessionTerminalTabs } from './runtime/mobile-session-terminal-projection'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const binding = {
  worktreeId: 'folder:launch-agent-test',
  tabId: 'hive-tab',
  leafId: '11111111-1111-4111-8111-111111111111',
  ptyId: 'hive-pty',
  incarnationId: 'inc-1',
  hostAdmittedMembership: true
}

describe('runtime launch identity persistence', () => {
  beforeEach(() => {
    const root = resolve('logs/p5-beta20-validation/persistence')
    mkdirSync(root, { recursive: true })
    testState.dir = mkdtempSync(join(root, 'launch-'))
  })

  it.each(['new', 'existing'] as const)(
    'restores authored Hive identity from a %s binding',
    async (kind) => {
      const store = createStore()
      if (kind === 'existing') {
        await store.persistPtyBinding(binding)
      }
      expect(await store.persistPtyBinding({ ...binding, launchAgent: 'hivecode' })).toBe(true)
      const restored = createStore().getWorkspaceSession()
      const tabs = restored.tabsByWorktree[binding.worktreeId]
      expect(tabs[0]).toMatchObject({
        id: binding.tabId,
        ptyId: binding.ptyId,
        launchAgent: 'hivecode'
      })
      expect(buildHeadlessMobileSessionTerminalTabs(binding.worktreeId, tabs, restored)).toEqual([
        expect.objectContaining({
          parentTabId: binding.tabId,
          leafId: binding.leafId,
          launchAgent: 'hivecode'
        })
      ])
      expect(await store.persistPtyBinding(binding)).toBe(true)
      expect(
        createStore().getWorkspaceSession().tabsByWorktree[binding.worktreeId][0].launchAgent
      ).toBe('hivecode')
    }
  )

  it('does not change launch identity when the exact binding fence is rejected', async () => {
    const store = createStore()
    await store.persistPtyBinding({ ...binding, launchAgent: 'codex' })
    expect(
      await store.persistPtyBinding({
        ...binding,
        launchAgent: 'hivecode',
        expectedBinding: { ptyId: 'other-pty' }
      })
    ).toBe(false)
    expect(
      createStore().getWorkspaceSession().tabsByWorktree[binding.worktreeId][0].launchAgent
    ).toBe('codex')
  })
})
