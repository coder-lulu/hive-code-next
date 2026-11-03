import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEffectiveKeybindingsForAction, keybindingMatchesAction } from '../../shared/keybindings'
import { getUserKeybindingsPath, writeKeybindingOverride } from './keybinding-file'
import { KeybindingService } from './keybinding-service'

describe('current keybinding service', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'hive-current-keybindings-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it.each(['darwin', 'linux', 'win32'] as const)(
    'uses current defaults without installation-age writes on %s',
    (platform) => {
      const markSeeded = vi.fn()
      const getLegacyOverrides = vi.fn(() => ({ 'view.tasks': ['Mod+Alt+T'] }))
      const options = { homePath: home, platform }
      Reflect.set(options, 'getLegacyOverrides', getLegacyOverrides)
      Reflect.set(options, 'legacyTabSwitchSeed', { isPending: () => true, markSeeded })
      const service = new KeybindingService(options)
      expect(service.getOverrides()).toEqual({})
      expect(existsSync(service.getPath())).toBe(false)
      expect(getLegacyOverrides).not.toHaveBeenCalled()
      expect(markSeeded).not.toHaveBeenCalled()
      expect(
        getEffectiveKeybindingsForAction('tab.nextAllTypes', platform, service.getOverrides())
      ).toEqual(['Mod+Shift+BracketRight'])
      expect(
        keybindingMatchesAction(
          'tab.nextAllTypes',
          {
            key: '}',
            code: 'BracketRight',
            meta: platform === 'darwin',
            control: platform !== 'darwin',
            alt: false,
            shift: true
          },
          platform,
          service.getOverrides()
        )
      ).toBe(true)
    }
  )

  it.each(['darwin', 'linux', 'win32'] as const)(
    'preserves explicit file overrides and physical matching on %s',
    (platform) => {
      const file = getUserKeybindingsPath(home)
      writeKeybindingOverride(file, platform, 'tab.nextSameType', ['Mod+K'])
      const before = readFileSync(file, 'utf8')
      const service = new KeybindingService({ homePath: home, platform })
      expect(
        getEffectiveKeybindingsForAction('tab.nextSameType', platform, service.getOverrides())
      ).toEqual(['Mod+K'])
      expect(
        keybindingMatchesAction(
          'tab.nextSameType',
          {
            key: 'k',
            code: 'KeyK',
            meta: platform === 'darwin',
            control: platform !== 'darwin',
            alt: false,
            shift: false
          },
          platform,
          service.getOverrides()
        )
      ).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe(before)
      expect(service.reload().overrides).toEqual(service.getOverrides())
      service.setActionBindings('tab.nextSameType', null)
      expect(
        getEffectiveKeybindingsForAction('tab.nextSameType', platform, service.getOverrides())
      ).toEqual(['Mod+Alt+BracketRight'])
    }
  )

  it('refuses writes to an unreadable file without replacing its bytes', () => {
    const file = getUserKeybindingsPath(home)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '{{invalid', 'utf8')
    const service = new KeybindingService({ homePath: home, platform: 'linux' })
    expect(readFileSync(file, 'utf8')).toBe('{{invalid')
    expect(service.getSnapshot().diagnostics).not.toEqual([])
    expect(() => service.setActionBindings('view.tasks', ['Mod+Alt+T'])).toThrow()
    expect(readFileSync(service.getPath(), 'utf8')).toBe('{{invalid')
  })

  it('keeps disabled shortcuts and active-platform precedence', () => {
    const file = getUserKeybindingsPath(home)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        keybindings: { 'terminal.search': 'Mod+Alt+F', 'view.tasks': [] },
        platforms: { linux: { 'terminal.search': 'Mod+Shift+F' }, darwin: {} }
      })
    )
    const service = new KeybindingService({ homePath: home, platform: 'linux' })
    expect(service.getOverrides()).toMatchObject({
      'terminal.search': ['Mod+Shift+F'],
      'view.tasks': []
    })
    service.setActionBindings('terminal.search', null)
    expect(service.getOverrides()).toMatchObject({
      'terminal.search': ['Mod+Alt+F'],
      'view.tasks': []
    })
  })
})
