import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mobileThemes } from '../theme/mobile-theme'
import type { ConnectionLogEntry } from '../transport/types'
import { ConnectionLog } from './ConnectionLog'

const themeState = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' }))

vi.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  CircleCheck: 'CircleCheck',
  CircleX: 'CircleX',
  Info: 'Info',
  TriangleAlert: 'TriangleAlert'
}))

vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => mobileThemes[themeState.scheme],
  useMobileThemeStyles: <T,>(
    factory: (theme: (typeof mobileThemes)[typeof themeState.scheme]) => T
  ) => factory(mobileThemes[themeState.scheme])
}))

const entries: ConnectionLogEntry[] = [
  { id: '1', ts: 1_000, level: 'info', message: '开始连接' },
  { id: '2', ts: 10_990, level: 'success', message: '连接成功', detail: '电脑 A' },
  { id: '3', ts: 13_345, level: 'warn', message: '连接较慢' },
  { id: '4', ts: 124_000, level: 'error', message: '连接中断' }
]

describe('ConnectionLog', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    themeState.scheme = 'light'
  })

  it('renders nothing without entries', () => {
    act(() => {
      renderer = create(createElement(ConnectionLog, { entries: [] }))
    })

    expect(renderer!.toJSON()).toBeNull()
  })

  it('keeps elapsed-time formatting, title, messages, and detail truncation stable', () => {
    act(() => {
      renderer = create(createElement(ConnectionLog, { entries, title: '配对日志' }))
    })

    const texts = renderer!.root.findAllByType('Text')
    const textContent = texts
      .map((node) => node.props.children)
      .filter((value) => typeof value === 'string')

    expect(textContent).toEqual(
      expect.arrayContaining([
        '配对日志',
        '+0.00s',
        '+9.99s',
        '+12.3s',
        '+123s',
        '开始连接',
        '连接成功',
        '电脑 A',
        '连接较慢',
        '连接中断'
      ])
    )
    expect(texts.find((node) => node.props.children === '电脑 A')?.props.numberOfLines).toBe(2)
  })

  it('continues scrolling to the newest entry when content grows', () => {
    const scrollToEnd = vi.fn()
    act(() => {
      renderer = create(createElement(ConnectionLog, { entries }), {
        createNodeMock: (element) => (element.type === 'ScrollView' ? { scrollToEnd } : null)
      })
    })

    act(() => renderer!.root.findByType('ScrollView').props.onContentSizeChange())
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: true })
  })

  it('uses Chinese level semantics in addition to icons and semantic status colors', () => {
    act(() => {
      renderer = create(createElement(ConnectionLog, { entries }))
    })

    const rows = renderer!.root.findAll(
      (node) => node.type === 'View' && node.props.accessibilityRole === 'text'
    )
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      '+0.00s，信息，开始连接',
      '+9.99s，成功，连接成功，电脑 A',
      '+12.3s，警告，连接较慢',
      '+123s，错误，连接中断'
    ])
    expect(renderer!.root.findByType('Info').props.color).toBe(
      mobileThemes.light.color.text.secondary
    )
    expect(renderer!.root.findByType('CircleCheck').props.color).toBe(
      mobileThemes.light.color.status.success
    )
    expect(renderer!.root.findByType('TriangleAlert').props.color).toBe(
      mobileThemes.light.color.status.warning
    )
    expect(renderer!.root.findByType('CircleX').props.color).toBe(
      mobileThemes.light.color.status.danger
    )
  })

  it('switches the log surface and content colors with the Graphite theme', () => {
    themeState.scheme = 'dark'
    act(() => {
      renderer = create(createElement(ConnectionLog, { entries, title: '连接日志' }))
    })

    expect(renderer!.root.findAllByType('View')[0]!.props.style).toMatchObject({
      backgroundColor: mobileThemes.dark.color.bg.surface,
      borderColor: mobileThemes.dark.color.border.default
    })
    expect(renderer!.root.findByType('CircleCheck').props.color).toBe(
      mobileThemes.dark.color.status.success
    )
    expect(
      renderer!.root.findAllByType('Text').find((node) => node.props.children === '连接日志')?.props
        .style
    ).toMatchObject({ color: mobileThemes.dark.color.text.secondary })
  })
})
