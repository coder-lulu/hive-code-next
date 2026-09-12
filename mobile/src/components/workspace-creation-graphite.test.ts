import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const componentSources = [
  'NewWorktreeFormSheet.tsx',
  'NewWorktreeProjectTargetFields.tsx',
  'SmartWorkspaceAdvancedFields.tsx',
  'SmartWorkspaceSourceField.tsx',
  'SmartWorkspaceSourceDrawer.tsx',
  'SmartWorkspaceSourceRow.tsx',
  'SetupHookTrustDrawer.tsx',
  'PickerListDrawer.tsx'
].map((fileName) => readFileSync(fileURLToPath(new URL(`./${fileName}`, import.meta.url)), 'utf8'))

const drawerStylesSource = readFileSync(
  fileURLToPath(new URL('./smart-workspace-source-drawer-styles.ts', import.meta.url)),
  'utf8'
)
const formStylesSource = readFileSync(
  fileURLToPath(new URL('./new-worktree-modal-styles.ts', import.meta.url)),
  'utf8'
)

describe('workspace creation Graphite presentation', () => {
  it('uses the live semantic theme instead of the legacy static palette', () => {
    for (const source of componentSources) {
      expect(source).toContain('useMobileTheme')
      expect(source).not.toMatch(
        /import\s*\{[^}]*\b(?:colors|spacing|typography|radii)\b[^}]*\}\s*from\s*['"][^'"]*mobile-theme['"]/i
      )
      expect(source).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i)
    }

    for (const source of [drawerStylesSource, formStylesSource]) {
      expect(source).toContain('MobileTheme')
      expect(source).not.toMatch(
        /import\s*\{[^}]*\b(?:colors|spacing|typography|radii)\b[^}]*\}\s*from\s*['"][^'"]*mobile-theme['"]/i
      )
      expect(source).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i)
    }
  })

  it('keeps form, picker, and trust actions at the shared interaction minimum', () => {
    const joined = componentSources.join('\n')
    expect(joined).toContain('minHeight: theme.size.minimumTouchTarget')
    expect(joined).toContain('minHeight: theme.size.groupedListRowMinHeight')
  })

  it('uses Graphite selected and inverse tokens for primary actions', () => {
    const joined = componentSources.join('\n')
    expect(joined).toContain('backgroundColor: theme.color.bg.selected')
    expect(joined).toContain('color: theme.color.text.inverse')
  })
})
