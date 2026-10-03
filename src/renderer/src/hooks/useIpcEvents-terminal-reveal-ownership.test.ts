import { describe, expect, it } from 'vitest'
import { setupTerminalCreateSurfacing } from './ipc-events-terminal-create-test-harness'

describe('terminal reveal with duplicate persisted PTY owners', () => {
  it.each([undefined, 'tab-unrelated'])('rejects repeated reveals with hint %s', async (tabId) => {
    const scenario = await setupTerminalCreateSurfacing(() => false)
    const { storeState, createTerminalListenerRef, createTab, replyTerminalCreate } = scenario
    const tabs = [
      { id: 'tab-original', ptyId: 'pty-live' },
      { id: 'tab-duplicate', ptyId: 'pty-live' },
      { id: 'tab-unrelated', ptyId: 'pty-other' }
    ]
    storeState.tabsByWorktree = { 'wt-1': tabs }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const requestId = `reveal-${attempt}`
      createTerminalListenerRef.current!({
        requestId,
        worktreeId: 'wt-1',
        ptyId: 'pty-live',
        presentation: 'background',
        ...(tabId ? { tabId } : {})
      })
      expect(replyTerminalCreate).toHaveBeenLastCalledWith({
        requestId,
        error: 'terminal_reveal_ambiguous_pty_owner'
      })
    }
    expect(createTab).not.toHaveBeenCalled()
    expect(scenario.updateTabPtyId).not.toHaveBeenCalled()
    expect(scenario.setTabLayout).not.toHaveBeenCalled()
    expect(storeState.tabsByWorktree['wt-1']).toEqual(tabs)
  })

  it('reuses an explicitly named owner despite another persisted claim', async () => {
    const scenario = await setupTerminalCreateSurfacing(() => false)
    scenario.storeState.tabsByWorktree = {
      'wt-1': [
        { id: 'tab-original', ptyId: 'pty-live', title: 'Original' },
        { id: 'tab-duplicate', ptyId: 'pty-live' }
      ]
    }
    scenario.createTerminalListenerRef.current!({
      requestId: 'exact-owner',
      worktreeId: 'wt-1',
      ptyId: 'pty-live',
      tabId: 'tab-original',
      presentation: 'background'
    })
    expect(scenario.createTab).not.toHaveBeenCalled()
    expect(scenario.replyTerminalCreate).toHaveBeenCalledWith({
      requestId: 'exact-owner',
      tabId: 'tab-original',
      title: 'Original'
    })
  })
})
