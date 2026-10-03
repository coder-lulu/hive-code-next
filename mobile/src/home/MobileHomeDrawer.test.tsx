import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { MobileHomeDrawer } from './MobileHomeDrawer'

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16 })
}))
vi.mock('lucide-react-native', () => ({
  ChevronRight: 'Icon',
  Clock3: 'Icon',
  ListTodo: 'Icon',
  LogIn: 'Icon',
  Monitor: 'Icon',
  Settings: 'Icon',
  MessageCircleQuestion: 'Icon'
}))
vi.mock('../components/OrcaLogo', () => ({ OrcaLogo: 'Logo' }))
vi.mock('./MobileDrawerApiQuota', () => ({ MobileDrawerApiQuota: 'ApiQuota' }))
vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ hydrated: true, session: null })
}))

describe('MobileHomeDrawer', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function renderDrawer() {
    const actions = {
      onManageDevices: vi.fn(),
      onClose: vi.fn(),
      onAccount: vi.fn(),
      onApiQuota: vi.fn(),
      onTasks: vi.fn(),
      onRecentWork: vi.fn(),
      onSettings: vi.fn(),
      onFeedback: vi.fn()
    }
    act(() => {
      renderer = create(
        createElement(MobileHomeDrawer, {
          ...actions,
          theme: lightTheme,
          visible: true,
          pairedComputerCount: 0,
          canOpenHostActions: false
        })
      )
    })
    return actions
  }

  function button(label: string) {
    const text = renderer!.root.findByProps({ children: label })
    return text.parent!.parent!
  }

  it('opens the computer entry from the drawer', () => {
    const actions = renderDrawer()
    act(() => {
      button('设备管理').props.onPress()
    })
    expect(actions.onManageDevices).toHaveBeenCalledOnce()
  })

  it('opens quota details from the drawer and unmounts its reader when closed', () => {
    const actions = renderDrawer()
    act(() => renderer!.root.findByType('ApiQuota' as never).props.onOpen())
    expect(actions.onApiQuota).toHaveBeenCalledOnce()
    act(() =>
      renderer!.update(
        createElement(MobileHomeDrawer, {
          ...actions,
          theme: lightTheme,
          visible: false,
          pairedComputerCount: 0,
          canOpenHostActions: false
        })
      )
    )
    expect(renderer!.root.findAllByType('ApiQuota' as never)).toHaveLength(0)
  })

  it('keeps secondary host actions unavailable until the selected runtime connects', () => {
    renderDrawer()
    for (const label of ['任务中心', '最近工作']) {
      expect(button(label).props.disabled).toBe(true)
    }
    expect(
      renderer!.root.findByProps({ accessibilityLabel: '打开设置' }).props.onPress
    ).toBeTruthy()
  })
})
