import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings, getDefaultUIState } from '../../../shared/constants'
import { mergeSettings, mergeWebUIState } from './preload-api/web-preference-normalization'
import { installBrowserGlobals } from './web-preload-api-test-harness'

afterEach(() => vi.unstubAllGlobals())
describe('current web explicit-false preferences', () => {
  it('preserves both false settings across unrelated updates', () => {
    const settings = mergeSettings(getDefaultSettings('~'), {
      autoRenameBranchFromWork: false,
      terminalAllowOsc52Clipboard: false
    })
    expect(mergeSettings(settings, { terminalFontSize: 17 })).toMatchObject({
      autoRenameBranchFromWork: false,
      terminalAllowOsc52Clipboard: false
    })
    expect(settings).not.toHaveProperty('autoRenameBranchFromWorkDefaultedOn')
    expect(settings).not.toHaveProperty('terminalAllowOsc52ClipboardDefaultedOnForAllUsers')
  })
  it('does not propagate a retired clipboard upgrade notice from local or host UI', () => {
    expect(
      mergeWebUIState(getDefaultUIState(), { osc52ClipboardDefaultOnNoticePending: true })
        .osc52ClipboardDefaultOnNoticePending
    ).not.toBe(true)
    expect(
      mergeWebUIState({ ...getDefaultUIState(), osc52ClipboardDefaultOnNoticePending: true }, {})
        .osc52ClipboardDefaultOnNoticePending
    ).not.toBe(true)
  })
  it('keeps persisted web opt-outs on read without arming an upgrade notice', async () => {
    const { storage } = installBrowserGlobals('Linux')
    storage.setItem(
      'orca.web.settings.v1',
      JSON.stringify({ autoRenameBranchFromWork: false, terminalAllowOsc52Clipboard: false })
    )
    const { getStoredSettings } = await import('./preload-api/web-preferences-store')
    expect(getStoredSettings()).toMatchObject({
      autoRenameBranchFromWork: false,
      terminalAllowOsc52Clipboard: false
    })
    expect(
      JSON.parse(storage.getItem('orca.web.ui.v1') ?? '{}').osc52ClipboardDefaultOnNoticePending
    ).not.toBe(true)
  })
})
