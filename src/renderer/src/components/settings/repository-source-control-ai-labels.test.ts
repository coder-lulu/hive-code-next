import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES } from '../../../../shared/source-control-ai-actions'
import { commandTemplateStateLabel } from './repository-source-control-ai-labels'

describe('commandTemplateStateLabel', () => {
  it('uses the configured product name for the default prompt label', () => {
    expect(
      commandTemplateStateLabel({
        hasOverride: false,
        inheritedTemplate: DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES.commitMessage,
        actionId: 'commitMessage'
      })
    ).toBe(`${APP_DISPLAY_NAME} default prompt`)
  })
})
