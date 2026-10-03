import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { HIDDEN_OUTPUT_RESTORE_UNAVAILABLE_WARNING } from './hidden-output-restore-limits'
import { STARTUP_CWD_FALLBACK_NOTICE } from './startup-cwd-fallback-notice'

describe('terminal recovery notices', () => {
  it.each([HIDDEN_OUTPUT_RESTORE_UNAVAILABLE_WARNING, STARTUP_CWD_FALLBACK_NOTICE])(
    'uses the current product name in %s',
    (notice) => {
      expect(notice).toContain(APP_DISPLAY_NAME)
      expect(notice).not.toContain('Orca')
    }
  )
})
