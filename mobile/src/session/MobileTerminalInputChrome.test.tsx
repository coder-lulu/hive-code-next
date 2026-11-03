import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkTheme, lightTheme, type MobileTheme } from '../theme/mobile-theme'
import { MobileTerminalInputActions } from './MobileTerminalInputActions'
import { MobileTerminalLiveInputStatus } from './MobileTerminalLiveInputStatus'

const mocks = vi.hoisted(() => ({ theme: undefined as MobileTheme | undefined }))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({ ImagePlus: 'ImagePlus', Mic: 'Mic' }))
vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme: defaultTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => mocks.theme ?? defaultTheme,
    useMobileThemeStyles: (factory: (theme: MobileTheme) => unknown) =>
      factory(mocks.theme ?? defaultTheme)
  }
})

function flattenStyle(style: unknown): Record<string, unknown> {
  const entries = Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]
  return Object.assign({}, ...entries)
}

const defaultProps = {
  canSend: true,
  isAttaching: false,
  dictation: { isStarting: false, isRecording: false, isProcessing: false },
  dictationMode: 'toggle' as const,
  buttonStyle: { width: 34, height: 34 },
  activeButtonStyle: { borderWidth: 2 },
  disabledButtonStyle: { opacity: 0.2 },
  onAttachImage: vi.fn(),
  onAttachFile: vi.fn(),
  onDictationToggle: vi.fn(),
  onDictationPressIn: vi.fn(),
  onDictationPressOut: vi.fn(),
  onDictationCancel: vi.fn()
}

describe('Mobile terminal input chrome', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    mocks.theme = lightTheme
    Object.values(defaultProps).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        value.mockClear()
      }
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function renderActions(overrides: Partial<typeof defaultProps> = {}) {
    await act(async () => {
      renderer = create(
        createElement(MobileTerminalInputActions, { ...defaultProps, ...overrides })
      )
    })
    return renderer!.root.findAllByType('Pressable')
  }

  it('preserves image tap/long-press actions with busy and disabled semantics', async () => {
    const [attachment] = await renderActions({ isAttaching: true })
    const style = flattenStyle(
      typeof attachment.props.style === 'function'
        ? attachment.props.style({ pressed: false })
        : attachment.props.style
    )

    expect(attachment.props).toMatchObject({
      accessibilityLabel: '正在发送图片',
      accessibilityHint: '长按可改为附加文件',
      accessibilityRole: 'button',
      accessibilityState: { busy: true, disabled: true },
      disabled: true
    })
    expect(style).toMatchObject({
      minHeight: 44,
      minWidth: 44,
      backgroundColor: lightTheme.color.bg.subtle,
      borderColor: lightTheme.color.border.default,
      borderRadius: lightTheme.radii.control
    })
  })

  it('preserves photo tap and file long-press callbacks', async () => {
    const [attachment] = await renderActions()

    act(() => {
      attachment.props.onPress()
      attachment.props.onLongPress()
    })

    expect(defaultProps.onAttachImage).toHaveBeenCalledOnce()
    expect(defaultProps.onAttachFile).toHaveBeenCalledOnce()
  })

  it('preserves toggle dictation and exposes its active state without color alone', async () => {
    mocks.theme = darkTheme
    const [, dictation] = await renderActions({
      dictation: { isStarting: false, isRecording: true, isProcessing: false }
    })
    const style = flattenStyle(dictation.props.style({ pressed: false }))
    const mic = renderer!.root.findByType('Mic')

    expect(dictation.props).toMatchObject({
      accessibilityLabel: '停止语音输入',
      accessibilityRole: 'button',
      accessibilityState: { busy: false, disabled: false, selected: true }
    })
    expect(style).toMatchObject({
      minHeight: 44,
      minWidth: 44,
      backgroundColor: darkTheme.color.bg.selected
    })
    expect(mic.props).toMatchObject({ color: darkTheme.color.text.inverse, size: 20 })

    act(() => {
      dictation.props.onPress()
      dictation.props.onLongPress()
    })
    expect(defaultProps.onDictationToggle).toHaveBeenCalledOnce()
    expect(defaultProps.onDictationCancel).toHaveBeenCalledOnce()
  })

  it('preserves hold-to-talk press-in and press-out callbacks', async () => {
    const [, dictation] = await renderActions({ dictationMode: 'hold' })

    act(() => {
      dictation.props.onPressIn()
      dictation.props.onPressOut()
    })

    expect(defaultProps.onDictationPressIn).toHaveBeenCalledOnce()
    expect(defaultProps.onDictationPressOut).toHaveBeenCalledOnce()
    expect(dictation.props.onPress).toBeUndefined()
  })

  it('localizes live status while preserving user input and dark semantic colors', async () => {
    mocks.theme = darkTheme
    await act(async () => {
      renderer = create(
        createElement(MobileTerminalLiveInputStatus, {
          dictation: { isStarting: false, isRecording: false, isProcessing: false },
          isAttaching: false,
          liveInputText: 'pnpm test'
        })
      )
    })
    const status = renderer!.root.findByProps({ accessibilityLiveRegion: 'polite' })
    const [title, detail] = renderer!.root.findAllByType('Text')

    expect(status.props.accessibilityLabel).toBe('实时输入：pnpm test')
    expect(title.props).toMatchObject({ maxFontSizeMultiplier: 1.3 })
    expect(title.props.children).toBe('实时输入')
    expect(flattenStyle(title.props.style).color).toBe(darkTheme.color.text.primary)
    expect(detail.props.children).toBe('pnpm test')
    expect(flattenStyle(detail.props.style).color).toBe(darkTheme.color.text.secondary)
  })

  it.each([
    [
      { isStarting: false, isRecording: true, isProcessing: false },
      false,
      '',
      '正在聆听',
      '轻点麦克风停止'
    ],
    [
      { isStarting: false, isRecording: false, isProcessing: true },
      false,
      '',
      '正在处理',
      '正在电脑上转写'
    ],
    [
      { isStarting: true, isRecording: false, isProcessing: false },
      false,
      '',
      '正在启动麦克风',
      '正在准备麦克风'
    ],
    [
      { isStarting: false, isRecording: false, isProcessing: false },
      true,
      '',
      '实时输入',
      '正在将图片上传到电脑'
    ]
  ] as const)(
    'maps terminal input state to %s / %s',
    async (dictation, isAttaching, liveInputText, expectedTitle, expectedDetail) => {
      await act(async () => {
        renderer = create(
          createElement(MobileTerminalLiveInputStatus, {
            dictation,
            isAttaching,
            liveInputText
          })
        )
      })
      const [title, detail] = renderer!.root.findAllByType('Text')

      expect(title.props.children).toBe(expectedTitle)
      expect(detail.props.children).toBe(expectedDetail)
    }
  )
})
