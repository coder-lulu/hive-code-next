import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() }
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Smartphone: 'Smartphone',
  UserPlus: 'UserPlus',
  X: 'X'
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 47 })
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    absoluteFillObject: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ fontScale: 1, height: 844, scale: 1, width: 390 })
}))
vi.mock('../components/OrcaLogo', () => ({ OrcaLogo: 'OrcaLogo' }))
vi.mock('./MobileLoginProviderIcon', () => ({
  MobileLoginProviderIcon: 'MobileLoginProviderIcon'
}))

import { MobileThemeProvider } from '../theme/mobile-theme-provider'
import { MobileLoginBottomSheet } from './MobileLoginBottomSheet'
import type { MobileLoginConfiguration } from './mobile-login-presentation'

const noProviders: MobileLoginConfiguration = {
  providers: [],
  registrationEnabled: false
}

function renderSheet(
  overrides: Partial<Parameters<typeof MobileLoginBottomSheet>[0]> = {}
): ReactTestRenderer {
  let renderer: ReactTestRenderer
  const props: Parameters<typeof MobileLoginBottomSheet>[0] = {
    agreed: false,
    busyActionKey: null,
    configuration: noProviders,
    onAction: vi.fn(),
    onAgreementChange: vi.fn(),
    onAgreementRequired: vi.fn(),
    onClose: vi.fn(),
    onOpenPrivacy: vi.fn(),
    onOpenTerms: vi.fn(),
    ...overrides
  }
  act(() => {
    renderer = create(
      createElement(
        MobileThemeProvider,
        { preference: 'light' },
        createElement(MobileLoginBottomSheet, props)
      )
    )
  })
  return renderer!
}

function buttonByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel === label)!
}

function visibleText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string')
    .join('')
}

describe('MobileLoginBottomSheet', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('removes registration/security notices and the complete provider section when unavailable', () => {
    renderer = renderSheet()

    expect(visibleText(renderer)).not.toContain('首次验证将自动注册新账号')
    expect(visibleText(renderer)).not.toContain('账号信息将加密传输')
    expect(visibleText(renderer)).not.toContain('其他方式登录')
    expect(renderer.root.findAllByType('MobileLoginProviderIcon')).toHaveLength(0)
  })

  it('renders only enabled providers in backend order with accessible names', () => {
    renderer = renderSheet({
      configuration: {
        registrationEnabled: true,
        providers: [
          {
            accessibilityLabel: '使用 GitHub 登录',
            authorizationPath: '/hive/v1/auth/provider-authorizations/github',
            enabled: false,
            id: 'github'
          },
          {
            accessibilityLabel: '使用 QQ 登录',
            authorizationPath: '/hive/v1/auth/provider-authorizations/qq',
            enabled: true,
            id: 'qq'
          },
          {
            accessibilityLabel: '使用微信登录',
            authorizationPath: '/hive/v1/auth/provider-authorizations/wechat',
            enabled: true,
            id: 'wechat'
          }
        ]
      }
    })

    const providerButtons = renderer.root
      .findAllByType('Pressable')
      .filter((node) => String(node.props.accessibilityLabel).startsWith('使用'))
    expect(providerButtons.map((node) => node.props.accessibilityLabel)).toEqual([
      '使用 QQ 登录',
      '使用微信登录'
    ])
    expect(visibleText(renderer)).not.toContain('首次验证将自动注册新账号')
    expect(visibleText(renderer)).not.toContain('账号信息将加密传输')
    expect(visibleText(renderer)).toContain('其他方式登录')
  })

  it('gates all authentication actions until agreement and keeps legal links independent', () => {
    const onAction = vi.fn()
    const onAgreementRequired = vi.fn()
    const onOpenPrivacy = vi.fn()
    const onOpenTerms = vi.fn()
    renderer = renderSheet({ onAction, onAgreementRequired, onOpenPrivacy, onOpenTerms })

    act(() => buttonByLabel(renderer!, '手机号登录').props.onPress())
    expect(onAgreementRequired).toHaveBeenCalledOnce()
    expect(onAction).not.toHaveBeenCalled()

    const links = renderer.root
      .findAllByType('Text')
      .filter((node) => node.props.accessibilityRole === 'link')
    act(() => links[0].props.onPress())
    act(() => links[1].props.onPress())
    expect(onOpenTerms).toHaveBeenCalledOnce()
    expect(onOpenPrivacy).toHaveBeenCalledOnce()

    act(() => renderer?.unmount())
    renderer = renderSheet({ agreed: true, onAction, onAgreementRequired })
    act(() => buttonByLabel(renderer!, '手机号登录').props.onPress())
    expect(onAction).toHaveBeenCalledWith({ kind: 'phone' })
  })

  it('disables every login action while one provider flow is active', () => {
    renderer = renderSheet({
      busyActionKey: 'provider:wechat',
      configuration: {
        registrationEnabled: false,
        providers: [
          {
            accessibilityLabel: '使用 GitHub 登录',
            authorizationPath: '/hive/v1/auth/provider-authorizations/github',
            enabled: true,
            id: 'github'
          },
          {
            accessibilityLabel: '使用微信登录',
            authorizationPath: '/hive/v1/auth/provider-authorizations/wechat',
            enabled: true,
            id: 'wechat'
          }
        ]
      }
    })

    expect(buttonByLabel(renderer, '手机号登录').props.accessibilityState).toEqual({
      busy: false,
      disabled: true
    })
    expect(buttonByLabel(renderer, '使用 GitHub 登录').props.accessibilityState).toEqual({
      busy: false,
      disabled: true
    })
    expect(buttonByLabel(renderer, '使用微信登录').props.accessibilityState).toEqual({
      busy: true,
      disabled: true
    })
    expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(1)
  })
})
