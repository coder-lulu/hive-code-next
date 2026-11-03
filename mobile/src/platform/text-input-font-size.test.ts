import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: {
    select: (choices: { default?: string; ios?: string }) => choices.ios ?? choices.default
  },
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 }
}))

import { mobileBrowserPaneStyles } from '../browser/mobile-browser-pane-styles'
import { customKeyModalStyles } from '../components/CustomKeyModal.styles'
import {
  composerInputStyles,
  COMPOSER_TEXT_SIZE,
  COMPOSER_LINE_HEIGHT
} from '../components/composer-input/composer-input-styles'
import { typography } from '../theme/mobile-theme'
import { TEXT_INPUT_FONT_SIZE } from './text-input-font-size'
import {
  TEXT_INPUT_FONT_SIZE_FLOOR,
  TEXT_INPUT_FONT_SIZE as WEB_TEXT_INPUT_FONT_SIZE
} from './text-input-font-size.web'

const MOBILE_ROOT = join(import.meta.dirname, '..', '..')
const source = (path: string) => readFileSync(join(MOBILE_ROOT, path), 'utf8')

// The current producer replaces the retired per-screen input styles. Keep every former consumer
// represented here, and verify the shared primitive actually forwards its focus-safe style.
const SHARED_INPUT_CONSUMERS = [
  ['src/source-control/MobileSourceControlContent.tsx', 'MessageBox'],
  ['src/components/MobileDiffReviewDrawers.tsx', 'MessageBox'],
  ['src/components/CustomKeyModal.tsx', 'TextField'],
  ['src/components/TextInputModal.tsx', 'TextField'],
  ['src/session/native-chat/input/MobileNativeChatAsk.tsx', 'MessageBox'],
  ['src/session/native-chat/input/MobileNativeChatQuestion.tsx', 'MessageBox'],
  ['src/session/QuickCommandEditorForm.tsx', 'TextField'],
  ['src/session/QuickCommandEditorForm.tsx', 'MessageBox'],
  ['src/session/QuickCommandsList.tsx', 'TextField'],
  ['src/session/MobileSessionCommandDock.tsx', 'MessageBox'],
  ['src/browser/MobileBrowserAddressField.tsx', 'TextField']
] as const

describe('the font size page-served text inputs carry', () => {
  it('clears the iOS web focus-zoom floor through both current size owners', () => {
    expect(TEXT_INPUT_FONT_SIZE_FLOOR).toBe(16)
    expect(WEB_TEXT_INPUT_FONT_SIZE).toBeGreaterThanOrEqual(TEXT_INPUT_FONT_SIZE_FLOOR)
    expect(COMPOSER_TEXT_SIZE).toBeGreaterThanOrEqual(TEXT_INPUT_FONT_SIZE_FLOOR)
    expect(COMPOSER_LINE_HEIGHT).toBeGreaterThanOrEqual(COMPOSER_TEXT_SIZE)
  })

  it('preserves native keyboard, shared composer, and larger key-capture sizes', () => {
    expect(TEXT_INPUT_FONT_SIZE).toBe(typography.bodySize)
    expect(mobileBrowserPaneStyles.keyboardInput.fontSize).toBe(TEXT_INPUT_FONT_SIZE)
    expect(composerInputStyles.fieldText.fontSize).toBe(COMPOSER_TEXT_SIZE)
    expect(composerInputStyles.messageText).toMatchObject({
      fontSize: COMPOSER_TEXT_SIZE,
      lineHeight: COMPOSER_LINE_HEIGHT
    })
    expect(customKeyModalStyles.keyInput.fontSize).toBe(22)
    expect(customKeyModalStyles.keyInput.fontSize).toBeGreaterThanOrEqual(
      TEXT_INPUT_FONT_SIZE_FLOOR
    )
  })

  it('binds the remaining browser keyboard style to the platform-swapped seam', () => {
    expect(source('src/browser/mobile-browser-pane-styles.ts')).toContain(
      'fontSize: TEXT_INPUT_FONT_SIZE'
    )
  })

  it.each(SHARED_INPUT_CONSUMERS)('%s uses the current %s producer', (path, primitive) => {
    const consumer = source(path)
    expect(consumer).toContain('composer-input/' + primitive)
    expect(consumer).toContain('<' + primitive)
  })

  it('binds real shared and native/web chat input implementations to those styles', () => {
    expect(source('src/components/composer-input/TextField.tsx')).toContain(
      'style={[styles.fieldText,'
    )
    expect(source('src/components/composer-input/MessageBox.tsx')).toContain('styles.messageText')
    expect(source('src/session/MobileSessionCommandDock.tsx')).toContain('inputStyles.fieldText')
    for (const suffix of ['', '.web']) {
      expect(
        source('src/session/native-chat/composer/MobileNativeChatComposerField' + suffix + '.tsx')
      ).toContain('composerInputStyles.messageText')
    }
    expect(source('src/components/composer-input/composer-input-styles.ts')).toContain(
      'fontSize: COMPOSER_TEXT_SIZE'
    )
  })
})
