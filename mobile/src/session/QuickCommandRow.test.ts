import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalQuickCommand } from '../../../src/shared/terminal-quick-command-types'
import { QuickCommandRow } from './QuickCommandRow'

const clipboard = vi.hoisted(() => ({ setStringAsync: vi.fn(() => Promise.resolve(true)) }))
const haptics = vi.hoisted(() => ({ notificationAsync: vi.fn(() => Promise.resolve()) }))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Copy: 'Copy',
  Pencil: 'Pencil',
  Play: 'Play',
  Trash2: 'Trash2'
}))

vi.mock('expo-clipboard', () => clipboard)

vi.mock('expo-haptics', () => ({
  ...haptics,
  performAndroidHapticsAsync: vi.fn(() => Promise.resolve()),
  AndroidHaptics: { Reject: 'reject' },
  NotificationFeedbackType: { Error: 'error', Success: 'success' }
}))

vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))

const COMMAND: TerminalQuickCommand = {
  id: 'qc-1',
  label: 'Run tests',
  command: 'run the tests',
  appendEnter: true
}

/**
 * The seventh migrated write, and the one that does not answer a refusal with a toast.
 *
 * A row inside a scrolling list says so on its own control: the copy button's label becomes
 * '无法复制' and its icon turns red for the same 1500 ms the toast would have lasted. What it
 * had no way to say was anything a thumb could feel, and the button sits under the thumb that just
 * pressed it. The seam rejects on a refusal rather than resolving false, so these two cases are the
 * difference between the row that shows a green check over nothing copied and the row that does not.
 */
describe('the quick-command row when the pasteboard refuses the text', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    clipboard.setStringAsync.mockReset()
    haptics.notificationAsync.mockReset()
    haptics.notificationAsync.mockImplementation(() => Promise.resolve())
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  /**
   * The copy control, found by its label rather than its position among the row's four buttons.
   *
   * All four labels the button can carry, because the label is what the copy state changes: a
   * finder keyed to one of them stops finding the button in the state it is meant to read.
   */
  const COPY_LABELS = new Set([`复制 ${COMMAND.label}`, '已复制', '无法复制', '无可复制内容'])

  function copyButton() {
    const button = renderer!.root
      .findAll((node) => node.props.accessibilityRole === 'button')
      .find((node) => COPY_LABELS.has(String(node.props.accessibilityLabel)))
    if (button === undefined) {
      throw new Error('the row has no copy button')
    }
    return button
  }

  function rowProps() {
    return {
      command: COMMAND,
      first: true,
      onLaunch: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      disabled: false
    }
  }

  async function mountAndCopy(): Promise<void> {
    await act(async () => {
      renderer = create(createElement(QuickCommandRow, rowProps()))
    })
    await act(async () => {
      copyButton().props.onPress()
    })
  }

  it('says it could not copy and buzzes the error', async () => {
    clipboard.setStringAsync.mockResolvedValue(false)
    await mountAndCopy()
    expect(copyButton().props.accessibilityLabel).toBe('无法复制')
    expect(haptics.notificationAsync).toHaveBeenCalledWith('error')
  })

  it('emits nothing at all when the row is gone before the refusal arrives', async () => {
    // A copy pressed on a row that then scrolls out of the list, or a sheet closed over it. The
    // rejection still arrives, and a buzz with no row to explain it is feedback for nothing.
    let refuse: ((error: Error) => void) | undefined
    clipboard.setStringAsync.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject
        })
    )
    await act(async () => {
      renderer = create(createElement(QuickCommandRow, rowProps()))
    })
    await act(async () => {
      copyButton().props.onPress()
    })
    act(() => renderer?.unmount())
    renderer = null
    await act(async () => {
      refuse?.(new Error('pasteboard refused'))
    })
    expect(haptics.notificationAsync).not.toHaveBeenCalled()
  })

  it('shows the copied label and no error buzz when the write lands', async () => {
    // The control: a failure assertion is only evidence if the success path reads differently.
    clipboard.setStringAsync.mockResolvedValue(true)
    await mountAndCopy()
    expect(copyButton().props.accessibilityLabel).toBe('已复制')
    expect(haptics.notificationAsync).not.toHaveBeenCalled()
  })
})

vi.mock('../theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('../theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: (factory: (theme: typeof lightTheme) => unknown) => factory(lightTheme)
  }
})
