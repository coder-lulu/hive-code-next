import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { MobilePrimaryNavigation } from './MobilePrimaryNavigation'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Bot: 'Bot',
  BookOpen: 'BookOpen',
  FolderKanban: 'FolderKanban',
  ListTodo: 'ListTodo',
  Workflow: 'Workflow'
}))

function resolvedStyle(node: ReactTestInstance): Record<string, unknown> {
  const style =
    typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style
  const entries = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...entries.filter(Boolean))
}

describe('MobilePrimaryNavigation', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('renders the fixed five destinations and exposes the active tab', () => {
    act(() => {
      renderer = create(
        createElement(MobilePrimaryNavigation, {
          active: 'workspace',
          bottomInset: 12,
          onSelect: () => {},
          theme: lightTheme
        })
      )
    })

    const labels = renderer.root
      .findAllByType('Text')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    expect(labels).toEqual(['任务', '智能体', '资料库', '自动化', '工作区'])

    const tabs = renderer.root.findAllByType('Pressable')
    expect(tabs).toHaveLength(5)
    expect(tabs.map((tab) => tab.props.accessibilityState.selected)).toEqual([
      false,
      false,
      false,
      false,
      true
    ])
    expect(tabs.every((tab) => resolvedStyle(tab).minHeight === 56)).toBe(true)
  })

  it('routes a tab selection through one stable callback', () => {
    const onSelect = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobilePrimaryNavigation, {
          active: 'tasks',
          bottomInset: 0,
          onSelect,
          theme: lightTheme
        })
      )
    })

    act(() => renderer!.root.findAllByType('Pressable')[2].props.onPress())
    expect(onSelect).toHaveBeenCalledWith('library')
  })
})
