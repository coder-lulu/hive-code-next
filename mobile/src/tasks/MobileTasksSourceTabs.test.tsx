import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { MOBILE_TASK_PROVIDER_OPTIONS, MobileTasksSourceTabs } from './MobileTasksSourceTabs'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    hairlineWidth: 1,
    create: <T,>(styles: T) => styles
  },
  Text: 'Text'
}))

vi.mock('lucide-react-native', () => ({ Code2: 'Code2', ListTodo: 'ListTodo' }))
vi.mock('../components/PickerModal', () => ({ PickerModal: 'PickerModal' }))
vi.mock('../components/TaskProviderLogo', () => ({ TaskProviderLogo: 'TaskProviderLogo' }))

describe('MobileTasksSourceTabs', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function renderTabs(overrides: Record<string, unknown> = {}) {
    const onSelectProvider = vi.fn()
    const onSelectView = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileTasksSourceTabs, {
          onCloseProviderPicker: vi.fn(),
          onOpenProviderPicker: vi.fn(),
          onSelectProvider,
          onSelectView,
          provider: 'github',
          providerPickerVisible: false,
          taskUiReady: true,
          theme: lightTheme,
          view: 'all',
          visibleProviders: ['github', 'gitlab', 'linear'],
          ...overrides
        })
      )
    })
    return { onSelectProvider, onSelectView }
  }

  it('keeps All and Local available while gating hosted providers on Runtime readiness', () => {
    const { onSelectView } = renderTabs({ taskUiReady: false })
    const tabs = renderer!.root.findAllByType('Pressable')

    expect(tabs).toHaveLength(5)
    expect(tabs[0]!.props.accessibilityState).toEqual({ disabled: false, selected: true })
    expect(tabs[1]!.props.accessibilityState.disabled).toBe(false)
    expect(tabs.slice(2).every((tab) => tab.props.disabled === true)).toBe(true)
    act(() => tabs[1]!.props.onPress())
    expect(onSelectView).toHaveBeenCalledWith('local')
  })

  it('selects and long-presses only visible hosted provider tabs', () => {
    const openPicker = vi.fn()
    const { onSelectProvider } = renderTabs({
      onOpenProviderPicker: openPicker,
      provider: 'gitlab',
      view: 'hosted',
      visibleProviders: ['github', 'gitlab']
    })
    const tabs = renderer!.root.findAllByType('Pressable')

    expect(tabs).toHaveLength(4)
    expect(tabs[3]!.props.accessibilityState.selected).toBe(true)
    act(() => tabs[3]!.props.onPress())
    act(() => tabs[2]!.props.onLongPress())
    expect(onSelectProvider).toHaveBeenCalledWith('gitlab')
    expect(openPicker).toHaveBeenCalledOnce()
  })

  it('retains provider picker metadata and 1.3x text scaling', () => {
    renderTabs({ providerPickerVisible: true, visibleProviders: ['linear'] })
    const picker = renderer!.root.findByType('PickerModal')
    const labels = renderer!.root.findAllByType('Text')

    expect(MOBILE_TASK_PROVIDER_OPTIONS.map(({ value, label }) => [value, label])).toEqual([
      ['github', 'GitHub'],
      ['gitlab', 'GitLab'],
      ['linear', 'Linear']
    ])
    expect(picker.props.visible).toBe(true)
    expect(picker.props.options.map((option: { value: string }) => option.value)).toEqual([
      'linear'
    ])
    expect(labels.every((label) => label.props.maxFontSizeMultiplier === 1.3)).toBe(true)
  })
})
