import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sources = {
  picker: readFileSync(fileURLToPath(new URL('./PickerModal.tsx', import.meta.url)), 'utf8'),
  customKey: readFileSync(fileURLToPath(new URL('./CustomKeyModal.tsx', import.meta.url)), 'utf8'),
  dragReorder: readFileSync(
    fileURLToPath(new URL('./DragReorderList.tsx', import.meta.url)),
    'utf8'
  )
} as const

describe('shared overlay Graphite presentation', () => {
  it('uses the live semantic theme instead of the legacy static palette', () => {
    for (const source of Object.values(sources)) {
      expect(source).toContain('useMobileTheme')
      expect(source).not.toMatch(
        /import\s*\{[^}]*\b(?:colors|spacing|typography|radii)\b[^}]*\}\s*from\s*['"][^'"]*mobile-theme['"]/i
      )
      expect(source).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i)
    }
  })

  it('keeps shared picker and reorder affordances at the 44dp interaction minimum', () => {
    expect(sources.picker).toContain('minHeight: theme.size.groupedListRowMinHeight')
    expect(sources.customKey).toContain('minHeight: theme.size.minimumTouchTarget')
    expect(sources.dragReorder).toContain('minWidth: theme.size.minimumTouchTarget')
  })

  it('keeps the custom shortcut workflow and its Graphite selected state', () => {
    for (const step of ['choose-type', 'shortcut-combo', 'special-keys', 'text-macro']) {
      expect(sources.customKey).toContain(step)
    }
    expect(sources.customKey).toContain('backgroundColor: theme.color.bg.selected')
    expect(sources.customKey).toContain('color: theme.color.text.inverse')
    expect(sources.customKey).toContain('onKeysChanged(updated)')
  })
})
