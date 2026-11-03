import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PickerListDrawer } from './PickerListDrawer'
import { useNewWorktreeDrawerNavigation } from './use-new-worktree-drawer-navigation'

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles }
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check' }))
vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: (factory: (theme: typeof lightTheme) => unknown) => factory(lightTheme)
  }
})

let renderer: ReactTestRenderer

afterEach(() => {
  act(() => renderer?.unmount())
  vi.useRealTimers()
})

describe('PickerListDrawer selection handoff', () => {
  it('discards the pending selection when its parent cancels before the hide completes', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const props = {
      visible: true,
      title: 'Run on',
      items: [{ id: 'switch-runtime', label: '切换 Runtime' }],
      selectedId: '',
      onSelect,
      onClose
    }
    act(() => {
      renderer = create(createElement(PickerListDrawer, props))
    })
    const list = renderer.root.findByType('FlatList')
    act(() => list.props.renderItem({ item: props.items[0] }).props.onPress())
    const finishHide = renderer.root.findByType('BottomDrawer').props.onAfterClose
    act(() => renderer.update(createElement(PickerListDrawer, { ...props, visible: false })))
    act(() => finishHide())
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('opens Runtime after the actual picker hides and ignores its late dismissal', () => {
    vi.useFakeTimers()
    let nav!: ReturnType<typeof useNewWorktreeDrawerNavigation>
    const selected = vi.fn()
    function Probe() {
      nav = useNewWorktreeDrawerNavigation(true)
      return createElement(PickerListDrawer, {
        visible: nav.drawerView === 'runTarget',
        title: 'Run on',
        items: [{ id: 'switch-runtime', label: '切换 Runtime' }],
        selectedId: '',
        onClose: () => nav.transitionDrawer('form'),
        onSelect: () => {
          selected()
          nav.transitionDrawer('runtime')
        }
      })
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => nav.transitionDrawer('runTarget'))
    act(() => vi.advanceTimersByTime(500))
    const list = renderer.root.findByType('FlatList')
    const row = list.props.renderItem({ item: list.props.data[0] })
    act(() => row.props.onPress())
    expect(selected).not.toHaveBeenCalled()
    const closingDrawer = renderer.root.findByType('BottomDrawer')
    expect(closingDrawer.props.visible).toBe(false)
    const delayedDismiss = closingDrawer.props.onClose
    act(() => closingDrawer.props.onAfterClose())
    act(() => delayedDismiss())
    act(() => vi.advanceTimersByTime(500))
    expect(selected).toHaveBeenCalledOnce()
    expect(nav.drawerView).toBe('runtime')
    act(() => closingDrawer.props.onAfterClose())
    expect(selected).toHaveBeenCalledOnce()
  })
})
