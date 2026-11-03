import { AccessibilityInfo } from 'react-native'
import type { ReactNode } from 'react'
import {
  findAllByHostType,
  findByHostType,
  isHostType
} from '../test-support/react-test-renderer-host-nodes'
import { createElement, useState } from 'react'
import { activateMobileUiLocale } from '../i18n/mobile-i18n'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat/input/native-chat-session-options'
import {
  MobileNativeChatSessionOptionPickers,
  type MobileNativeChatPickerPresentation
} from './MobileNativeChatSessionOptionPickers'
import type { MobileNativeChatSessionOptionsController } from './native-chat/input/use-mobile-native-chat-session-options'

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibilityWithOptions: vi.fn() },
  Platform: { OS: 'ios' },
  ActivityIndicator: 'ActivityIndicator',
  Keyboard: { dismiss: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({
  FilePenLine: 'FilePenLine',
  Hand: 'Hand',
  LockKeyhole: 'LockKeyhole',
  ShieldAlert: 'ShieldAlert',
  ShieldCheck: 'ShieldCheck',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  X: 'X'
}))
vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: <T>(factory: (theme: typeof lightTheme) => T) => factory(lightTheme)
  }
})
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', { visible }, children) : null
  }
})

const MODEL_DESCRIPTOR: SessionOptionDescriptor = {
  id: 'model',
  label: 'Model',
  category: 'model',
  kind: {
    type: 'select',
    currentValue: 'sonnet',
    choices: [
      { value: 'sonnet', label: 'Sonnet 5' },
      { value: 'opus', label: 'Opus 4.8', description: 'Most capable' }
    ]
  },
  valueSource: 'reported',
  transport: 'catalog',
  settable: true
}

const EFFORT_DESCRIPTOR: SessionOptionDescriptor = {
  id: 'effort',
  label: 'Effort',
  category: 'thought_level',
  kind: {
    type: 'select',
    currentValue: 'high',
    choices: [
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' }
    ]
  },
  valueSource: 'dispatched',
  transport: 'catalog',
  settable: true
}

const FAST_MODE_DESCRIPTOR: SessionOptionDescriptor = {
  id: 'fastMode',
  label: 'Fast mode',
  category: 'mode',
  kind: { type: 'boolean', currentValue: false },
  valueSource: 'reported',
  transport: 'catalog',
  settable: true
}

describe('MobileNativeChatSessionOptionPickers', () => {
  let renderer: ReactTestRenderer | null = null
  const setOption = vi.fn<MobileNativeChatSessionOptionsController['setOption']>()
  const invokeAction = vi.fn<MobileNativeChatSessionOptionsController['invokeAction']>()

  const mount = (snapshot: SessionOptionDescriptor[], isWorking = false): void => {
    const controller: MobileNativeChatSessionOptionsController = {
      snapshot,
      pendingId: null,
      setOption,
      invokeAction,
      recordCommand: vi.fn()
    }
    function Harness() {
      const [presentation, setPresentation] = useState<MobileNativeChatPickerPresentation | null>(
        null
      )
      return createElement(MobileNativeChatSessionOptionPickers, {
        controller,
        isWorking,
        presentation,
        onDrawerOpen: (page) => setPresentation({ page, refocus: false }),
        onNavigate: (page) => setPresentation((current) => (current ? { ...current, page } : null))
      })
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
  }

  const pill = (name: string): ReactTestInstance =>
    renderer!.root.find(
      (node) =>
        isHostType(node, 'Pressable') &&
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith(name)
    )

  const rowByText = (text: string): ReactTestInstance => {
    const label = findByHostType(renderer!.root, 'BottomDrawer')
      .findAll((node) => isHostType(node, 'Text'))
      .find((node) => node.props.children === text)
    if (!label) {
      throw new Error(`No row labeled ${text}`)
    }
    let parent = label.parent
    while (parent && !isHostType(parent, 'Pressable')) {
      parent = parent.parent
    }
    if (!parent) {
      throw new Error(`No pressable row for ${text}`)
    }
    return parent
  }

  beforeEach(async () => {
    await activateMobileUiLocale('zh')
    setOption.mockReset()
    setOption.mockResolvedValue(true)
    invokeAction.mockReset()
    invokeAction.mockResolvedValue(true)
  })
  afterEach(async () => {
    act(() => {
      renderer?.unmount()
    })
    renderer = null
    await activateMobileUiLocale('en')
  })

  it('renders nothing without a model descriptor', () => {
    mount([])
    expect(renderer!.toJSON()).toBeNull()
  })

  it('shows the current model and effort in one pill', () => {
    mount([MODEL_DESCRIPTOR, EFFORT_DESCRIPTOR])
    expect(pill('模型').props).toMatchObject({
      accessibilityLabel: '模型，Sonnet 5 高',
      disabled: false
    })
    const labels = renderer!.root
      .findAll((node) => isHostType(node, 'Text'))
      .map((node) => node.props.children)
    expect(labels).toContain('Sonnet 5')
    expect(labels).toContain('  高')
  })

  it('lets the pill shrink so a long label never pushes the composer buttons off the row', () => {
    mount([MODEL_DESCRIPTOR, EFFORT_DESCRIPTOR])
    // Style-level only: the test renderer runs no layout.
    expect(findAllByHostType(renderer!.root, 'View')[0]!.props.style).toMatchObject({
      flexShrink: 1
    })
  })

  it('opens the model sheet and applies a picked model', async () => {
    mount([MODEL_DESCRIPTOR, EFFORT_DESCRIPTOR])
    await act(async () => pill('模型').props.onPress())
    expect(findByHostType(renderer!.root, 'BottomDrawer').props.visible).toBe(true)
    await act(async () => rowByText('Opus 4.8').props.onPress())
    expect(setOption).toHaveBeenCalledWith('model', 'opus')
  })

  it('picks effort from the model sheet segmented control', async () => {
    mount([MODEL_DESCRIPTOR, EFFORT_DESCRIPTOR])
    await act(async () => pill('模型').props.onPress())
    await act(async () => rowByText('低').props.onPress())
    expect(setOption).toHaveBeenCalledWith('effort', 'low')
  })

  it('shows absolute boolean values in option summaries', async () => {
    mount([MODEL_DESCRIPTOR, FAST_MODE_DESCRIPTOR])
    await act(async () => pill('模型').props.onPress())
    const toggle = findByHostType(renderer!.root, 'Switch')
    expect(toggle.props).toMatchObject({
      accessibilityLabel: '快速模式',
      value: false,
      disabled: false
    })
    await act(async () => toggle.props.onValueChange(true))
    expect(setOption).toHaveBeenCalledWith('fastMode', true)
  })

  it('announces choice selection and disabled state', async () => {
    mount([MODEL_DESCRIPTOR, EFFORT_DESCRIPTOR])
    expect(pill('模型').props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityState: { disabled: false }
    })
    await act(async () => pill('模型').props.onPress())
    expect(rowByText('Sonnet 5').props).toMatchObject({
      accessibilityRole: 'radio',
      accessibilityState: { checked: true, disabled: false }
    })
    expect(rowByText('Opus 4.8').props.accessibilityState?.checked).toBe(false)
  })

  it('closes without dispatch when re-picking the tracked value', async () => {
    mount([MODEL_DESCRIPTOR, EFFORT_DESCRIPTOR])
    await act(async () => pill('模型').props.onPress())
    await act(async () => rowByText('Sonnet 5').props.onPress())
    expect(setOption).not.toHaveBeenCalled()
  })

  it('renders agent-picker descriptors as a single action row', async () => {
    mount([
      {
        ...MODEL_DESCRIPTOR,
        kind: { type: 'select', choices: [] },
        valueSource: 'unknown',
        transport: 'catalog',
        action: { type: 'agent-picker' }
      }
    ])
    await act(async () => pill('模型').props.onPress())
    expect(rowByText('在智能体选择器中选择…').props.accessibilityRole).toBe('button')
    await act(async () => rowByText('在智能体选择器中选择…').props.onPress())
    expect(invokeAction).toHaveBeenCalledWith('model')
  })

  // The terminal transport can only learn the outcome by parsing the screen back,
  // so the sheet admits the value is unconfirmed; the structured transport reports
  // it every turn, which makes the same caption noise there.
  it.each([
    { transport: 'catalog' as const, caption: true },
    { transport: 'agent-session' as const, caption: false }
  ])('captions a dispatched value only on the terminal transport', async (scenario) => {
    mount([
      MODEL_DESCRIPTOR,
      { ...EFFORT_DESCRIPTOR, valueSource: 'dispatched', transport: scenario.transport }
    ])
    await act(async () => pill('模型').props.onPress())
    const captions = renderer!.root
      .findAll((node) => isHostType(node, 'Text'))
      .filter((node) => node.props.children === '已发送给智能体 — 尚未确认')
    expect(captions.length > 0).toBe(scenario.caption)
  })

  it.each(['catalog', 'agent-session'] as const)(
    'does not caption a reported value on the %s transport',
    async (transport) => {
      mount([MODEL_DESCRIPTOR, { ...EFFORT_DESCRIPTOR, valueSource: 'reported', transport }])
      await act(async () => pill('模型').props.onPress())
      expect(
        renderer!.root
          .findAll((node) => isHostType(node, 'Text'))
          .some((node) => node.props.children === '已发送给智能体 — 尚未确认')
      ).toBe(false)
    }
  )

  it('locks model and effort choices while keeping the working notice accessible', async () => {
    mount([MODEL_DESCRIPTOR, EFFORT_DESCRIPTOR], true)
    await act(async () => pill('模型').props.onPress())
    for (const label of ['Sonnet 5', 'Opus 4.8', '低', '高']) {
      expect(rowByText(label).props).toMatchObject({
        disabled: true,
        accessibilityRole: 'radio',
        accessibilityState: { disabled: true }
      })
    }
    expect(renderer!.root.findByProps({ children: '智能体正在工作' })).toBeDefined()
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
      '智能体正在工作。本轮结束后将解锁模型设置。',
      { queue: false }
    )
    expect(setOption).not.toHaveBeenCalled()
  })

  it('shows the permission pill before any model pill, and closes at once on a pick', async () => {
    mount([PERMISSION_DESCRIPTOR], true)
    expect(pill('权限').props).toMatchObject({
      accessibilityLabel: '权限，Ask for approval',
      disabled: false
    })
    // A write that waits behind a starting agent never holds the sheet open.
    setOption.mockImplementation(() => new Promise(() => {}))
    await act(async () => pill('权限').props.onPress())
    await act(async () => rowByText('Full access').props.onPress())
    expect(setOption).toHaveBeenCalledWith('permissionMode', 'full-access')
    expect(findAllByHostType(renderer!.root, 'BottomDrawer')).toEqual([])
  })
})

const PERMISSION_DESCRIPTOR: SessionOptionDescriptor = {
  id: 'permissionMode',
  label: 'Permissions',
  category: 'mode',
  kind: {
    type: 'select',
    currentValue: 'ask',
    choices: [
      { value: 'ask', label: 'Ask for approval' },
      { value: 'full-access', label: 'Full access' }
    ]
  },
  valueSource: 'applied',
  transport: 'agent-session',
  settable: true
}
