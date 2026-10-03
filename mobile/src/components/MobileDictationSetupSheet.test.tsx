import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mobileThemes } from '../theme/mobile-theme'
import type { RpcClient } from '../transport/rpc-client'
import { MobileDictationSetupSheet } from './MobileDictationSetupSheet'

const themeState = vi.hoisted(() => ({ scheme: 'dark' as 'light' | 'dark' }))
const haptics = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(() => ({ remove: vi.fn() }))
  },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({ Check: 'Check', Download: 'Download' }))

vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => mobileThemes[themeState.scheme],
  useMobileThemeStyles: <T,>(
    factory: (theme: (typeof mobileThemes)[typeof themeState.scheme]) => T
  ) => factory(mobileThemes[themeState.scheme])
}))

vi.mock('../platform/haptics', () => ({
  triggerError: haptics.error,
  triggerSuccess: haptics.success
}))

vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

function resolvedStyle(node: ReactTestInstance): Record<string, unknown> {
  const style =
    typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style
  const items = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...items.filter(Boolean))
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('MobileDictationSetupSheet', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    themeState.scheme = 'dark'
    haptics.error.mockClear()
    haptics.success.mockClear()
  })

  it('uses one Graphite model group and preserves remote setup actions', async () => {
    let selectedModelId = 'ready-selected'
    let enabled = true
    const models = [
      {
        id: 'ready-selected',
        label: 'Fast local',
        provider: 'local' as const,
        sizeBytes: 100_000_000,
        recommended: false,
        status: 'ready' as const,
        progress: null
      },
      {
        id: 'ready-other',
        label: 'Accurate local',
        provider: 'local' as const,
        sizeBytes: 200_000_000,
        recommended: true,
        status: 'ready' as const,
        progress: null
      },
      {
        id: 'downloadable',
        label: 'Compact local',
        provider: 'local' as const,
        sizeBytes: 50_000_000,
        recommended: false,
        status: 'not-downloaded' as const,
        progress: null
      }
    ]
    const result = () => ({
      enabled,
      selectedModelId,
      dictationMode: 'toggle' as const,
      models
    })
    const sendRequest = vi.fn(async (method: string, params: unknown) => {
      if (method === 'speech.dictation.setup') {
        const next = params as { enabled?: boolean; modelId?: string }
        enabled = next.enabled ?? enabled
        selectedModelId = next.modelId ?? selectedModelId
      }
      return { ok: true as const, result: result() }
    })
    const client = { sendRequest } as unknown as RpcClient
    const onReady = vi.fn()

    await act(async () => {
      renderer = create(
        createElement(MobileDictationSetupSheet, {
          visible: true,
          client,
          onClose: vi.fn(),
          onReady
        })
      )
      await flush()
    })

    expect(sendRequest).toHaveBeenCalledWith('speech.models.list', null)
    const modelsGroup = renderer!.root
      .findAllByType('View')
      .find((node) => resolvedStyle(node).overflow === 'hidden')!
    expect(resolvedStyle(modelsGroup)).toMatchObject({
      borderRadius: 12,
      backgroundColor: mobileThemes.dark.color.bg.surface,
      borderColor: mobileThemes.dark.color.border.default
    })
    expect(
      renderer!.root.findAllByType('View').filter((node) => resolvedStyle(node).height === 1)
    ).toHaveLength(2)

    const dictationSwitch = renderer!.root.findByType('Switch')
    expect(dictationSwitch.props.accessibilityLabel).toBe('Dictation enabled')
    expect(dictationSwitch.props.trackColor.true).toBe(mobileThemes.dark.color.bg.selected)
    await act(async () => {
      dictationSwitch.props.onValueChange(false)
      await flush()
    })
    expect(sendRequest).toHaveBeenCalledWith('speech.dictation.setup', { enabled: false })

    const useButton = renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Use voice model Accurate local')!
    expect(resolvedStyle(useButton).minHeight).toBe(44)
    await act(async () => {
      useButton.props.onPress()
      await flush()
    })
    expect(sendRequest).toHaveBeenCalledWith('speech.dictation.setup', {
      enabled: true,
      modelId: 'ready-other'
    })
    expect(haptics.success).toHaveBeenCalledOnce()
    expect(onReady).toHaveBeenCalledOnce()

    const downloadButton = renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Download voice model Compact local')!
    await act(async () => {
      downloadButton.props.onPress()
      await flush()
    })
    expect(sendRequest).toHaveBeenCalledWith('speech.models.download', {
      modelId: 'downloadable'
    })
  })
})
