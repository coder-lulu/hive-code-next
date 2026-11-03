import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import type { LucideIcon } from 'lucide-react-native'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFillObject: { position: 'absolute', inset: 0 },
    create: <T,>(styles: T) => styles
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('lucide-react-native', () => ({ LockKeyhole: 'LockKeyhole' }))

import { MobileThemeProvider } from '../../theme/mobile-theme-provider'
import { PairingActionButton } from './PairingActionButton'
import { PairingCodeSheet } from './PairingCodeSheet'
import { pairingEndpointLabel } from './pairing-endpoint-label'
import { PairingScreenContent, PairingSecurityNotice } from './PairingScreenContent'

const TestIcon = ((props: Record<string, unknown>) =>
  createElement('TestIcon', props)) as unknown as LucideIcon

function renderWithTheme(children: ReactNode): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(MobileThemeProvider, { systemSchemeOverride: 'light' }, children)
    )
  })
  return renderer!
}

function resolvedStyle(node: ReactTestInstance, pressed = false): Record<string, unknown> {
  const style =
    typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const values = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...values.filter(Boolean))
}

describe('pairing UI', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('uses a graphite 48dp primary action with semantic radius', () => {
    renderer = renderWithTheme(
      createElement(PairingActionButton, {
        icon: TestIcon,
        label: '确认并连接',
        onPress: () => {}
      })
    )
    const button = renderer.root.findByType('Pressable')
    expect(resolvedStyle(button)).toMatchObject({
      minHeight: 48,
      borderRadius: 8,
      backgroundColor: '#17191D'
    })
    expect(button.props.accessibilityState).toEqual({ busy: false, disabled: false })
    expect(renderer.root.findByType('TestIcon').props).toMatchObject({ size: 20, strokeWidth: 2 })
  })

  it('keeps manual pairing disabled until a non-empty code is entered', () => {
    const onSubmit = vi.fn()
    renderer = renderWithTheme(
      createElement(PairingCodeSheet, { onCancel: () => {}, onSubmit, visible: true })
    )
    const input = renderer.root.findByType('TextInput')
    const submitLabel = renderer.root
      .findAllByType('Text')
      .find((node) => node.children.includes('验证并连接'))!
    expect(submitLabel.parent!.props.disabled).toBe(true)

    act(() => input.props.onChangeText('  hivecode://pair?code=abc  '))
    const updatedSubmitLabel = renderer.root
      .findAllByType('Text')
      .find((node) => node.children.includes('验证并连接'))!
    expect(updatedSubmitLabel.parent!.props.disabled).toBe(false)
    act(() => updatedSubmitLabel.parent!.props.onPress())
    expect(onSubmit).toHaveBeenCalledWith('hivecode://pair?code=abc')
  })

  it('pairs danger copy with an icon and preserves the encrypted-storage notice', () => {
    renderer = renderWithTheme(
      createElement(
        PairingScreenContent,
        {
          description: '请重新生成配对码。',
          icon: TestIcon,
          title: '设备授权失败',
          tone: 'danger'
        },
        createElement(PairingSecurityNotice)
      )
    )
    const text = renderer.root.findAllByType('Text').flatMap((node) => node.children)
    expect(text).toContain('设备授权失败')
    expect(text).toContain('配对凭据保存在本机，通信使用端到端加密')
    expect(renderer.root.findByType('TestIcon').props.color).toBe('#E5484D')
    expect(renderer.root.findByType('LockKeyhole')).toBeTruthy()
  })
})

describe('pairingEndpointLabel', () => {
  it('shows only host and port without credentials, paths, or query values', () => {
    const label = pairingEndpointLabel('wss://user:secret@desktop.local:6768/private?token=hidden')
    expect(label).toBe('desktop.local:6768')
    expect(label).not.toContain('secret')
    expect(label).not.toContain('token')
  })

  it('does not echo an invalid endpoint', () => {
    expect(pairingEndpointLabel('not a url with secret')).toBe('已验证的桌面连接地址')
  })
})
