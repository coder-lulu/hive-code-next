import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WallAppUpdate } from '../app-update/use-wall-app-update'
import { INITIAL_SNAPSHOT } from '../update/mobile-update-state'
import type { BlockedVerdict } from './ProtocolBlockScreen'
import { ProtocolBlockScreen } from './ProtocolBlockScreen'

const nativeTestState = vi.hoisted(() => {
  // Declared wide so a test can switch stores; an assertion here would only widen the same literal.
  const platform: { OS: 'ios' | 'android' } = { OS: 'ios' }
  return { openUrl: vi.fn(), platform }
})

const wallUpdate = vi.hoisted(() => {
  const state: { current: WallAppUpdate | null } = { current: null }
  return state
})

// The wall delegates verified native installation to the existing Hive updater owner.
vi.mock('../app-update/use-wall-app-update', () => ({ useWallAppUpdate: () => wallUpdate.current }))

vi.mock('react-native', () => ({
  Linking: { openURL: nativeTestState.openUrl },
  Platform: nativeTestState.platform,
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('lucide-react-native', () => ({ ShieldAlert: 'ShieldAlert' }))
vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: <T>(factory: (theme: typeof lightTheme) => T) => factory(lightTheme)
  }
})
vi.mock('../platform/external-link', () => ({
  openExternalLink: (...args: unknown[]) => nativeTestState.openUrl(...args)
}))

vi.mock('expo-router', () => ({
  router: { replace: vi.fn() },
  // `ProtocolBlockScreen` reaches the router through the navigation handoff now, and the handoff's
  // native form is this hook. Its web form is what posts the target to the shell.
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), dismissTo: vi.fn() })
}))

let renderer: ReactTestRenderer | null = null

function render(verdict: BlockedVerdict, mobileUpdate: WallAppUpdate | null = null): string {
  wallUpdate.current = mobileUpdate
  act(() => {
    renderer = create(createElement(ProtocolBlockScreen, { verdict }))
  })
  return JSON.stringify(renderer?.toJSON())
}

/** The mocked host components are plain strings, which `ElementType` does not admit. */
function isMockedHostElement(type: unknown, name: string): boolean {
  return type === name
}

function pressableCount(): number {
  return renderer?.root.findAll((node) => isMockedHostElement(node.type, 'Pressable')).length ?? 0
}

describe('ProtocolBlockScreen', () => {
  beforeEach(() => {
    nativeTestState.openUrl.mockClear()
    nativeTestState.platform.OS = 'ios'
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('renders the HiveCode protocol wall without inventing unavailable download links', () => {
    const mobile = render({
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion: 5,
      requiredMobileVersion: 99
    })
    expect(mobile).toContain('Update HiveCode Mobile')
    expect(mobile).toContain(
      'This desktop needs a newer HiveCode Mobile app. Update HiveCode Mobile from the official iOS distribution channel, then try this host again.'
    )
    expect(mobile).not.toContain('Open iOS download')
    expect(pressableCount()).toBe(1)
    act(() => renderer?.unmount())

    const desktop = render({
      kind: 'blocked',
      reason: 'desktop-too-old',
      desktopVersion: 0,
      requiredDesktopVersion: 2
    })
    expect(desktop).toContain('Update HiveCode on your computer')
    expect(desktop).toContain(
      'This paired desktop app is too old for your current HiveCode Mobile app. Update HiveCode on your computer, then try this host again.'
    )
    expect(desktop).not.toContain('Open desktop download')
    expect(pressableCount()).toBe(1)
  })

  it('explains a host without a bundle without fabricating a desktop download', () => {
    const output = render({ kind: 'blocked', reason: 'bundle-unavailable' })
    expect(output).toContain('Update HiveCode on your computer')
    expect(output).toContain(
      'This paired desktop app does not include the mobile workspace yet. Update HiveCode on your computer, then try this host again.'
    )
    expect(output).not.toContain('Open desktop download')
    expect(pressableCount()).toBe(1)
    expect(nativeTestState.openUrl).not.toHaveBeenCalled()
  })

  it('explains an unknown manifest schema using the configured distribution channel', () => {
    const output = render({
      kind: 'blocked',
      reason: 'bundle-shell-too-old',
      schemaVersion: 2
    })
    expect(output).toContain('Update HiveCode Mobile')
    expect(output).toContain(
      "This desktop's mobile workspace needs a newer HiveCode Mobile app. Update HiveCode Mobile from the official iOS distribution channel, then try this host again."
    )
    expect(output).not.toContain('Open iOS download')
    expect(pressableCount()).toBe(1)
  })

  it('offers no download for a cached bundle the host outgrew, because none would clear it', () => {
    const output = render({
      kind: 'blocked',
      reason: 'bundle-incompatible',
      side: 'mobile',
      bundleRuntimeProtocolVersion: 3,
      requiredBundleRuntimeProtocolVersion: 4
    })

    expect(output).toContain('Refresh the mobile workspace')
    expect(output).toContain(
      'The workspace cached for this host is older than the desktop expects. Reconnect to this host to download the current one.'
    )
    // A store update cannot replace a stale cache, so neither store link is offered.
    expect(output).not.toContain('Open iOS download')
    expect(output).not.toContain('Open desktop download')
    expect(output).not.toContain('Update HiveCode')
    // Back to hosts is the only button left, and it is not a download.
    expect(pressableCount()).toBe(1)
    expect(output).toContain('Back to hosts')
    // Nothing was "already updated" here; the note keeps only the pairing fallback.
    expect(output).not.toContain('Already updated?')
    expect(output).toContain('If this message stays, remove this host and pair it again.')
  })

  it('explains when the host is older than its own bundle', () => {
    const output = render({
      kind: 'blocked',
      reason: 'bundle-incompatible',
      side: 'desktop',
      hostProtocolVersion: 1,
      requiredHostProtocolVersion: 2
    })
    expect(output).toContain('Update HiveCode on your computer')
    expect(output).toContain(
      'This paired desktop app is too old for your current HiveCode Mobile app'
    )
    expect(output).not.toContain('Open desktop download')
    expect(pressableCount()).toBe(1)
  })

  it('sends a desktop whose page is older than this shell to the desktop update', () => {
    const output = render({
      kind: 'blocked',
      reason: 'bundle-incompatible',
      side: 'desktop',
      pageVersion: 0,
      requiredPageVersion: 1
    })
    expect(output).toContain('Update HiveCode on your computer')
    expect(output).toContain(
      'This paired desktop app is too old for your current HiveCode Mobile app'
    )
    expect(output).not.toContain('Open desktop download')
    expect(pressableCount()).toBe(1)
  })

  it('names the Android distribution channel without fabricating a listing', () => {
    nativeTestState.platform.OS = 'android'
    const output = render({
      kind: 'blocked',
      reason: 'bundle-shell-too-old',
      schemaVersion: 2
    })
    expect(output).toContain(
      'Update HiveCode Mobile from the official Android distribution channel'
    )
    expect(output).not.toContain('Open Android download')
    expect(pressableCount()).toBe(1)
  })

  it('keeps the full recovery note when no configured download action exists', () => {
    const output = render({ kind: 'blocked', reason: 'bundle-unavailable' })
    expect(output).toContain('Already updated? Go back to Hosts and refresh the connection.')
    expect(pressableCount()).toBe(1)
  })

  describe('with a verified Hive update available', () => {
    function update(overrides: Partial<WallAppUpdate> = {}): WallAppUpdate {
      return {
        version: '1.5.0-beta.24',
        pending: false,
        message: null,
        // The fixture proves delegation only; it never claims a native installation succeeded.
        install: vi.fn<WallAppUpdate['install']>(async () => ({
          ...INITIAL_SNAPSHOT,
          state: 'not-available',
          message: 'The test does not perform native installation'
        })),
        ...overrides
      }
    }

    it('delegates the Android action to the verified Hive installer', () => {
      nativeTestState.platform.OS = 'android'
      const release = update()
      const output = render(
        { kind: 'blocked', reason: 'bundle-shell-too-old', schemaVersion: 2 },
        release
      )
      expect(output).toContain('获取 HiveCode 1.5.0-beta.24')
      const action = renderer!.root.findByProps({
        accessibilityLabel: '获取 HiveCode 1.5.0-beta.24'
      })
      expect(action.props.accessibilityRole).toBe('button')
      expect(action.props.disabled).toBe(false)
      act(() => action.props.onPress())
      expect(release.install).toHaveBeenCalledOnce()
      expect(nativeTestState.openUrl).not.toHaveBeenCalled()
    })

    it('keeps an installation in progress disabled and announces its message', () => {
      nativeTestState.platform.OS = 'android'
      const release = update({ pending: true, message: '正在下载已验证的更新' })
      const output = render(
        { kind: 'blocked', reason: 'bundle-shell-too-old', schemaVersion: 2 },
        release
      )
      const action = renderer!.root.findByProps({
        accessibilityLabel: '获取 HiveCode 1.5.0-beta.24'
      })
      expect(action.props.disabled).toBe(true)
      expect(action.props.accessibilityState).toEqual({ busy: true })
      expect(output).toContain('正在下载已验证的更新')
      expect(release.install).not.toHaveBeenCalled()
    })

    it('displays a real updater failure without reporting installation success', () => {
      nativeTestState.platform.OS = 'android'
      const output = render(
        { kind: 'blocked', reason: 'bundle-shell-too-old', schemaVersion: 2 },
        update({ message: '无法打开安装程序，请检查系统权限' })
      )
      expect(output).toContain('无法打开安装程序，请检查系统权限')
      expect(nativeTestState.openUrl).not.toHaveBeenCalled()
    })

    it.each([
      { kind: 'blocked', reason: 'bundle-unavailable' },
      {
        kind: 'blocked',
        reason: 'bundle-incompatible',
        side: 'mobile',
        bundleRuntimeProtocolVersion: 3,
        requiredBundleRuntimeProtocolVersion: 4
      }
    ] as const)('does not install a mobile package to clear $reason', (verdict) => {
      const release = update()
      const output = render(verdict, release)
      expect(output).not.toContain('获取 HiveCode')
      expect(pressableCount()).toBe(1)
      expect(release.install).not.toHaveBeenCalled()
      expect(nativeTestState.openUrl).not.toHaveBeenCalled()
    })
  })

  it.each(['ios', 'android'] as const)(
    'keeps the updater unavailable on %s without a verified artifact or configured link',
    (os) => {
      nativeTestState.platform.OS = os
      const output = render(
        { kind: 'blocked', reason: 'mobile-too-old', desktopVersion: 5, requiredMobileVersion: 9 },
        null
      )
      expect(output).not.toContain('获取 HiveCode')
      expect(pressableCount()).toBe(1)
      expect(nativeTestState.openUrl).not.toHaveBeenCalled()
    }
  )
})
