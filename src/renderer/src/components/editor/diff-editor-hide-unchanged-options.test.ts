import { describe, expect, it } from 'vitest'
import { buildDiffEditorHideUnchangedOptions } from './diff-editor-hide-unchanged-options'

describe('buildDiffEditorHideUnchangedOptions', () => {
  it('enables collapsing for new and legacy settings unless explicitly disabled', () => {
    for (const value of [true, undefined]) {
      expect(buildDiffEditorHideUnchangedOptions(value)).toEqual({
        hideUnchangedRegions: { enabled: true }
      })
    }
  })

  // Why: the option must always be present, not omitted when off. Monaco keeps the last applied
  // value across an options update, so dropping the key would strand a diff editor in collapsed
  // mode after the user turns the setting back off.
  it('emits an explicit disabled state when the user turns it off', () => {
    expect(buildDiffEditorHideUnchangedOptions(false)).toEqual({
      hideUnchangedRegions: { enabled: false }
    })
  })
})
