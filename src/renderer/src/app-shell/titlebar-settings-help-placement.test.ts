import { describe, expect, it } from 'vitest'
import { resolveSettingsHelpPlacement } from './titlebar-settings-help-placement'

describe('settings and help control placement', () => {
  it.each([
    {
      name: 'new workspace creation',
      input: {
        creationLayoutActive: true,
        mainStripMounted: false,
        workspaceChromeActive: false,
        rightSidebarVisible: true
      },
      expected: 'shell-overlay'
    },
    {
      name: 'workspace with the right sidebar closed',
      input: {
        creationLayoutActive: false,
        mainStripMounted: false,
        workspaceChromeActive: true,
        rightSidebarVisible: false
      },
      expected: 'shell-overlay'
    },
    {
      name: 'workspace with the right sidebar open',
      input: {
        creationLayoutActive: false,
        mainStripMounted: false,
        workspaceChromeActive: true,
        rightSidebarVisible: true
      },
      expected: 'right-sidebar'
    },
    {
      name: 'landing page with the context rail open',
      input: {
        creationLayoutActive: false,
        mainStripMounted: false,
        workspaceChromeActive: false,
        rightSidebarVisible: true
      },
      expected: 'right-sidebar'
    },
    {
      name: 'non-workspace page',
      input: {
        creationLayoutActive: false,
        mainStripMounted: true,
        workspaceChromeActive: false,
        rightSidebarVisible: false
      },
      expected: 'main-strip'
    },
    {
      name: 'page with its own header',
      input: {
        creationLayoutActive: false,
        mainStripMounted: false,
        workspaceChromeActive: false,
        rightSidebarVisible: false
      },
      expected: 'shell-overlay'
    }
  ] as const)('uses one owner for $name', ({ input, expected }) => {
    expect(resolveSettingsHelpPlacement(input)).toBe(expected)
  })
})
