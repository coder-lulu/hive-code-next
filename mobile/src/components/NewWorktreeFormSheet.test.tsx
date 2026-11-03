import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { darkTheme, lightTheme, type MobileTheme } from '../theme/mobile-theme'
import { NewWorktreeFormSheet } from './NewWorktreeFormSheet'

let currentTheme = lightTheme
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({ ChevronDown: 'ChevronDown', ChevronUp: 'ChevronUp' }))
vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => currentTheme,
  useMobileThemeStyles: <T,>(factory: (theme: MobileTheme) => T) => factory(currentTheme)
}))
vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('./MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./NewWorktreeProjectTargetFields', () => ({
  NewWorktreeProjectTargetFields: 'ProjectFields'
}))
vi.mock('./NewWorkspaceSetupScriptField', () => ({ NewWorkspaceSetupScriptField: 'SetupField' }))
vi.mock('./NewWorkspaceSshConnectionField', () => ({ NewWorkspaceSshConnectionField: 'SshField' }))
vi.mock('./SmartWorkspaceAdvancedFields', () => ({
  SmartWorkspaceAdvancedFields: 'AdvancedFields'
}))
vi.mock('./SmartWorkspaceSourceField', () => ({ SmartWorkspaceSourceField: 'SourceField' }))

function style(node: ReactTestInstance) {
  const value =
    typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style
  return Object.assign({}, ...(Array.isArray(value) ? value : [value]).filter(Boolean))
}
let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

it.each([lightTheme, darkTheme])(
  'uses the active theme for form title, agent and submit controls ($mode)',
  (theme) => {
    currentTheme = theme
    const props = {
      visible: true,
      interactive: true,
      hasRepos: true,
      canCreate: true,
      creating: false,
      composer: {},
      sshGate: { requiresConnection: false },
      selectedAgent: { id: 'codex', label: 'Codex' }
    } as ComponentProps<typeof NewWorktreeFormSheet>
    act(() => {
      renderer = create(createElement(NewWorktreeFormSheet, props))
    })
    const texts = renderer!.root.findAllByType('Text')
    const title = texts.find((node) => node.props.children === 'Create worktree')!
    expect(style(title).color).toBe(theme.color.text.primary)
    const agent = renderer!.root.findByProps({ accessibilityLabel: 'Select agent' })
    expect(style(agent).backgroundColor).toBe(theme.color.bg.surface)
    expect(style(texts.find((node) => node.props.children === 'Codex')!).color).toBe(
      theme.color.text.primary
    )
    const submit = renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityState?.busy === false)!
    expect(style(submit).backgroundColor).toBe(theme.color.bg.selected)
    expect(style(submit.findByType('Text')).color).toBe(theme.color.text.inverse)
    expect(style(agent).minHeight).toBeGreaterThanOrEqual(theme.size.minimumTouchTarget)
    act(() => {
      renderer!.update(
        createElement(NewWorktreeFormSheet, { ...props, creating: true, canCreate: false })
      )
    })
    expect(renderer!.root.findByType('ActivityIndicator').props.color).toBe(
      theme.color.text.inverse
    )
  }
)
