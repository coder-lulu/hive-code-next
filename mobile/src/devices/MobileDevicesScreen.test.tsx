import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { MobileDevicesScreen } from './MobileDevicesScreen'
import { testDevices } from './mobile-devices.test-fixture'

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ActivityIndicator: 'Loading',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
  SectionList: (props: {
    sections: { title: string; data: unknown[] }[]
    renderSectionHeader: (item: unknown) => React.ReactNode
    renderItem: (item: unknown) => React.ReactNode
    ListEmptyComponent: React.ReactNode
    ListFooterComponent: React.ReactNode
  }) =>
    createElement(
      'List',
      props,
      props.sections.length
        ? props.sections.map((section) =>
            createElement(
              'Section',
              { key: section.title },
              props.renderSectionHeader({ section }),
              section.data.map((item, index) =>
                createElement('Row', { key: index }, props.renderItem({ item, index, section }))
              )
            )
          )
        : props.ListEmptyComponent,
      props.ListFooterComponent
    )
}))
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    [
      'ChevronRight',
      'ArrowRight',
      'CircleHelp',
      'Plus',
      'Laptop',
      'LoaderCircle',
      'Monitor',
      'MoreHorizontal',
      'RefreshCw',
      'Server'
    ].map((name) => [name, 'Icon'])
  )
)
vi.mock('../hooks/use-now', () => ({ useNow: () => 30 * 60_000 + 1000 }))
vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => lightTheme,
  useMobileThemeStyles: (factory: (theme: typeof lightTheme) => unknown) => factory(lightTheme)
}))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})
function mount(overrides: Partial<Parameters<typeof MobileDevicesScreen>[0]> = {}) {
  const props = {
    devices: testDevices(),
    theme: lightTheme,
    contentMaxWidth: 600,
    paths: { 'device-0': 'lan' as const },
    pendingId: null,
    loading: false,
    error: null,
    onAdd: vi.fn(),
    onHelp: vi.fn(),
    onRefresh: vi.fn(),
    onActions: vi.fn(),
    onDetails: vi.fn(),
    onRetry: vi.fn(),
    ...overrides
  }
  act(() => {
    renderer = create(createElement(MobileDevicesScreen, props))
  })
  return props
}
const press = (label: string) =>
  act(() => renderer!.root.findByProps({ accessibilityLabel: label }).props.onPress())
describe('device page layout and controls', () => {
  it('renders current connection details and grouped other devices, with live filter counts', () => {
    mount()
    expect(
      renderer!.root
        .findByType('List')
        .props.sections.map((section: { title: string }) => section.title)
    ).toEqual(['当前使用', '其他设备'])
    expect(renderer!.root.findByProps({ children: '设备管理' })).toBeTruthy()
    expect(renderer!.root.findByProps({ children: '连接方式：直连' })).toBeTruthy()
    for (const label of ['工作区', '活动会话', '打开会话', '使用此设备']) {
      expect(renderer!.root.findAllByProps({ children: label })).toHaveLength(0)
    }
    press('未连接，2 台设备')
    expect(renderer!.root.findAllByProps({ children: '打开会话' })).toHaveLength(0)
    expect(renderer!.root.findByType('List').props.sections[0].data).toHaveLength(2)
    press('已连接，1 台设备')
    expect(renderer!.root.findByType('List').props.sections[0].data).toHaveLength(1)
  })
  it('wires actions, retry, help, add and current connection details to their actual callbacks', () => {
    const props = mount()
    press('添加设备')
    press('连接帮助')
    press('查看详情：开发电脑')
    press('开发电脑 的更多操作')
    press('查看详情：MacBook Pro')
    press('重试连接：开发服务器')
    expect(props.onAdd).toHaveBeenCalledOnce()
    expect(props.onHelp).toHaveBeenCalledOnce()
    expect(props.onDetails).toHaveBeenCalledWith(props.devices[0].host)
    expect(props.onActions).toHaveBeenCalledWith(props.devices[0].host)
    expect(props.onDetails).toHaveBeenCalledWith(props.devices[1].host)
    expect(props.onRetry).toHaveBeenCalledWith(props.devices[2].host)
  })
  it('keeps a healthy empty catalog distinct from a failed load and offers retry', () => {
    const props = mount({ devices: [], error: '账号目录读取失败' })
    expect(renderer!.root.findByProps({ children: '设备读取失败' })).toBeTruthy()
    press('重试读取设备')
    expect(props.onRefresh).toHaveBeenCalledOnce()
  })
  it('keeps unknown paths explicit and opens details for another connected device', () => {
    const devices = testDevices().map((device, index) =>
      index === 1 ? { ...device, connected: true, connecting: false, label: '已连接' } : device
    )
    const props = mount({ devices, paths: {} })
    expect(renderer!.root.findByProps({ children: '连接方式：未确认' })).toBeTruthy()
    press('查看详情：MacBook Pro')
    expect(props.onDetails).toHaveBeenCalledWith(devices[1].host)
    expect(renderer!.root.findAllByProps({ children: '使用此设备' })).toHaveLength(0)
  })
})
