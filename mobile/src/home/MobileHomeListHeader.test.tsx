import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { MobileHomeListHeader } from './MobileHomeListHeader'

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('../theme/mobile-theme-provider', () => ({ useMobileTheme: () => lightTheme }))

describe('Original Orca home summary', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  function renderHeader(props: Parameters<typeof MobileHomeListHeader>[0]) {
    act(() => {
      renderer = create(createElement(MobileHomeListHeader, props))
    })
    return renderer!.root.findAllByType('Text').map((node) => node.children.join(''))
  }

  it('shows the empty computer section heading without fabricated statistics', () => {
    expect(renderHeader({ stats: null })).toEqual(['电脑'])
  })

  it('shows actual agent, duration and PR totals when a summary is available', () => {
    const labels = renderHeader({
      stats: {
        totalAgentsSpawned: 7,
        totalAgentTimeMs: 3_600_000,
        totalPRsCreated: 2,
        firstEventAt: null
      }
    })
    expect(labels).toEqual(['7', '已启动 Agent', '1h 0m', 'Agent 用时', '2', '已创建 PR', '电脑'])
  })
})
