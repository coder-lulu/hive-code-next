import { createElement } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileUpdateObserver } from './MobileUpdateObserver'
import { mobileUpdateLabel } from './mobile-update-presentation'
import type { MobileUpdateSnapshot } from './mobile-update-service'

const deps = vi.hoisted(() => ({
  snapshot: {} as MobileUpdateSnapshot,
  install: vi.fn(),
  dismiss: vi.fn()
}))
vi.mock('./use-mobile-update', () => ({ useMobileUpdate: () => deps }))
vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  Platform: { OS: 'android' }
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 44, right: 0 })
}))
vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('../theme/mobile-theme')
  return { useMobileTheme: () => lightTheme }
})
let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.clearAllMocks()
  deps.snapshot = {
    state: 'available',
    version: '1.5.0-beta.9',
    buildNumber: 27,
    mandatory: false,
    minimumSupportedBuild: null,
    message: 'Fixes',
    promptVisible: true,
    downloadedBytes: 0,
    totalBytes: 100,
    artifact: {
      packageFormat: 'apk',
      distributionType: 'direct',
      downloadUrl: 'https://test.invalid',
      storeUrl: null,
      sha256: 'a',
      size: 100
    }
  }
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
})
async function render() {
  await act(async () => {
    renderer = create(createElement(MobileUpdateObserver))
  })
  return renderer!
}
describe('mobile update prompt', () => {
  it('respects horizontal safe areas and offers installation after a background download', async () => {
    deps.snapshot.state = 'ready-to-install'
    const view = await render()
    expect(view.root.findAllByType(View)[0].props.style.paddingLeft).toBe(44)
    expect(view.root.findByProps({ accessibilityLabel: '打开安装器' }).props.disabled).toBe(false)
    expect(JSON.stringify(view.toJSON())).toContain('安装包已准备好')
  })
  it('offers download and defer for ordinary updates, without automatically installing', async () => {
    const view = await render()
    expect(JSON.stringify(view.toJSON())).toContain('发现新版本')
    expect(deps.install).not.toHaveBeenCalled()
    const buttons = view.root.findAllByType(Pressable)
    await act(async () =>
      buttons.find((button) => button.props.accessibilityLabel === '下载并安装')!.props.onPress()
    )
    expect(deps.install).toHaveBeenCalledOnce()
    await act(async () =>
      buttons.find((button) => button.props.accessibilityLabel === '稍后更新')!.props.onPress()
    )
    expect(deps.dismiss).toHaveBeenCalledOnce()
  })
  it('shows byte-based progress and prevents a duplicate download click', async () => {
    deps.snapshot.state = 'downloading'
    deps.snapshot.downloadedBytes = 42
    const view = await render()
    expect(
      view.root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityValue.now
    ).toBe(42)
    expect(view.root.findByProps({ accessibilityLabel: '正在下载' }).props.disabled).toBe(true)
  })
  it('keeps the mandatory modal visible while checking and offers no defer button', async () => {
    deps.snapshot.state = 'checking'
    deps.snapshot.mandatory = true
    const view = await render()
    expect(view.root.findByType(Modal).props.visible).toBe(true)
    expect(view.root.findAllByProps({ accessibilityLabel: '稍后更新' })).toHaveLength(0)
  })
  it('hides a deferred ordinary prompt', async () => {
    deps.snapshot.promptVisible = false
    expect((await render()).toJSON()).toBe(null)
  })
  it('never labels an unchecked or uninstalled version as current', () => {
    expect(mobileUpdateLabel({ ...deps.snapshot, state: 'idle' })).toBe('检查是否有新版本')
    expect(mobileUpdateLabel({ ...deps.snapshot, state: 'ready-to-install' })).toBe('等待完成安装')
    expect(mobileUpdateLabel({ ...deps.snapshot, state: 'not-available' })).toBe('已是最新版本')
  })
})
