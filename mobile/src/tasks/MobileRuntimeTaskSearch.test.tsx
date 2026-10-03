import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import {
  MOBILE_TASK_EXECUTION_FILTER_OPTIONS,
  MobileRuntimeTaskSearch
} from './MobileRuntimeTaskSearch'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: {
    hairlineWidth: 1,
    create: <T,>(styles: T) => styles
  },
  TextInput: 'TextInput',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Search: 'Search',
  SlidersHorizontal: 'SlidersHorizontal',
  X: 'X'
}))

vi.mock('../components/PickerModal', () => ({ PickerModal: 'PickerModal' }))

describe('MobileRuntimeTaskSearch', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('opens a real status picker and exposes the selected filter accessibly', () => {
    const onFilterChange = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileRuntimeTaskSearch, {
          filter: 'all',
          onChangeText: vi.fn(),
          onFilterChange,
          placeholder: '搜索任务',
          theme: lightTheme,
          value: ''
        })
      )
    })

    const filterButton = renderer!.root.findByProps({
      accessibilityLabel: '筛选任务状态，全部状态'
    })
    expect(filterButton.props.accessibilityState).toEqual({ selected: false })
    act(() => filterButton.props.onPress())

    const picker = renderer!.root.findByType('PickerModal')
    expect(picker.props.visible).toBe(true)
    expect(picker.props.options).toEqual(MOBILE_TASK_EXECUTION_FILTER_OPTIONS)
    act(() => picker.props.onSelect('in-progress'))
    expect(onFilterChange).toHaveBeenCalledWith('in-progress')
  })

  it('keeps 1.3x text scaling and clears the Runtime query', () => {
    const onChangeText = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileRuntimeTaskSearch, {
          filter: 'in-progress',
          onChangeText,
          onFilterChange: vi.fn(),
          placeholder: '搜索本地任务',
          theme: lightTheme,
          value: 'Codex'
        })
      )
    })

    expect(renderer!.root.findByType('TextInput').props.maxFontSizeMultiplier).toBe(1.3)
    expect(
      renderer!.root.findByProps({ accessibilityLabel: '筛选任务状态，进行中' }).props
        .accessibilityState
    ).toEqual({ selected: true })
    act(() => renderer!.root.findByProps({ accessibilityLabel: '清除搜索' }).props.onPress())
    expect(onChangeText).toHaveBeenCalledWith('')
  })
})
