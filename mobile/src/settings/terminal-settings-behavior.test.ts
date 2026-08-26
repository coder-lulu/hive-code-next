import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('Terminal and Native Chat settings behavior', () => {
  it('keeps the default session view backed by the existing preference hook', () => {
    const route = source('../../app/native-chat-settings.tsx')

    expect(route).toContain('useMobileDefaultSessionViewPreference()')
    expect(route).toContain("defaultView === 'chat'")
    expect(route).toContain("setDefaultView(next ? 'chat' : 'terminal')")
  })

  it('keeps terminal text size and autocomplete preferences', () => {
    const route = source('../../app/terminal-settings.tsx')

    expect(route).toContain('loadTerminalTextScale().then(setTextScale)')
    expect(route).toContain('saveTerminalTextScale(opt.scale)')
    expect(route).toContain('loadTerminalAutocompleteEnabled().then((enabled) =>')
    expect(route).toContain('saveTerminalAutocompleteEnabled(next)')
    expect(route).toContain('userToggledAutocompleteRef.current')
    for (const scale of ['0.5', '0.75', '1', '1.25', '1.5', '2']) {
      expect(route).toContain(`scale: ${scale}`)
    }
  })

  it('keeps per-host auto-restore reads, optimistic writes, and recovery reads', () => {
    const route = source('../../app/terminal-settings.tsx')

    expect(route).toContain("sendRequest('terminal.getAutoRestoreFit')")
    expect(route).toContain("sendRequest('terminal.setAutoRestoreFit'")
    expect(route).toContain('setTerminalAutoRestoreFitMsForHost')
    expect(route).toContain("type RestoreValue = 'indefinite' | '60s' | '5m' | '30m'")
    expect(route.match(/sendRequest\('terminal\.getAutoRestoreFit'\)/g)).toHaveLength(2)
  })

  it('keeps shortcut visibility, order, custom-key persistence, and drag coordination', () => {
    const shortcuts = source('../components/TerminalShortcutSettings.tsx')

    for (const behavior of [
      'loadTerminalAccessoryLayout',
      'saveTerminalAccessoryLayout',
      'setTerminalAccessoryBuiltInVisible',
      'reorderTerminalAccessoryBuiltInIds',
      'loadCustomKeys',
      'saveCustomKeys',
      'handleDeleteCustomKey',
      'onDragActiveChange',
      'pendingLayoutWritesRef',
      'pendingCustomKeysWritesRef'
    ]) {
      expect(shortcuts).toContain(behavior)
    }
    expect(shortcuts).toContain('getDefaultTerminalAccessoryLayout()')
    expect(shortcuts).toContain('setShowCustomKeyModal(true)')
  })
})
