import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainCss = fs.readFileSync(new URL('./main.css', import.meta.url), 'utf8')
const composerSource = fs.readFileSync(
  new URL('../components/landing/DesktopHomeComposerFooter.tsx', import.meta.url),
  'utf8'
)
const floatingWorkspaceToggleSource = fs.readFileSync(
  new URL('../components/floating-terminal/FloatingTerminalToggleButton.tsx', import.meta.url),
  'utf8'
)

function getCssRuleBody(selector: string): string {
  const ruleMarker = mainCss.indexOf(`\n${selector} {`)
  expect(ruleMarker).toBeGreaterThanOrEqual(0)

  const bodyStart = mainCss.indexOf('{', ruleMarker) + 1
  const bodyEnd = mainCss.indexOf('}', bodyStart)
  return mainCss.slice(bodyStart, bodyEnd)
}

describe('desktop home dark-theme surfaces', () => {
  it('keeps the account trigger and popover on theme-aware surfaces', () => {
    const triggerState = getCssRuleBody(".hive-account-trigger[data-state='open']")
    const popover = getCssRuleBody('.hive-account-popover')
    const menuItem = getCssRuleBody('.hive-account-menu-item')

    expect(triggerState).toContain('var(--worktree-sidebar-accent)')
    expect(popover).toContain('color: var(--popover-foreground)')
    expect(popover).toContain('background: var(--popover)')
    expect(menuItem).toContain('color: var(--popover-foreground)')
  })

  it('keeps the account sign-in dialog and its brand panel theme-aware', () => {
    const dialog = getCssRuleBody('.hive-account-dialog')
    const brandPanel = getCssRuleBody('.hive-account-brand-panel')
    const phoneInput = getCssRuleBody('.hive-account-text-input')

    expect(dialog).toContain('color: var(--card-foreground)')
    expect(dialog).toContain('background: var(--card)')
    expect(brandPanel).toContain('background: var(--secondary)')
    expect(phoneInput).toContain('background: var(--background)')
  })

  it('keeps the composite input footer and disabled send button theme-aware', () => {
    const contextRail = getCssRuleBody('.desktop-home-composer-context')
    const disabledSend = getCssRuleBody(
      '.desktop-home-composer-toolbar .desktop-home-send:disabled'
    )

    expect(contextRail).toContain('background: var(--secondary)')
    expect(contextRail).not.toMatch(/background:\s*#(?:fff|f5f6f7)/i)
    expect(disabledSend).toContain('background: var(--muted)')
    expect(disabledSend).toContain('color: var(--muted-foreground)')
  })

  it('does not force the composer dropdowns onto light-only utility colors', () => {
    expect(composerSource).not.toContain('bg-white')
    expect(composerSource).not.toContain('border-[#DDE1E6]')
    expect(composerSource).toContain('bg-popover')
    expect(composerSource).toContain('border-border')
  })

  it('caps the project selector trigger before truncating its label', () => {
    const projectTrigger = getCssRuleBody(
      '.desktop-home-composer-context > .desktop-home-project-trigger'
    )

    expect(projectTrigger).toContain('max-width: 320px')
  })

  it('keeps the bottom floating workspace control dark-aware', () => {
    expect(floatingWorkspaceToggleSource).toContain('dark:bg-accent')
    expect(floatingWorkspaceToggleSource).not.toContain('dark:bg-white')
  })
})
