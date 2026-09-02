import { describe, expect, it } from 'vitest'
import {
  MOBILE_TASKS_SOURCE_FILES,
  readMobileTasksSource
} from './mobile-tasks-source-family.test-support'

const PRODUCT_ROUTE = '../../app/h/[hostId]/tasks.tsx'

describe('Mobile Tasks product-boundary parity', () => {
  it('keeps the HiveCode Graphite task center as the active route', () => {
    const source = readMobileTasksSource(PRODUCT_ROUTE)

    expect(source).toContain("from '../../../src/theme/mobile-theme-provider'")
    expect(source).toContain('const theme = useMobileTheme()')
    expect(source).toContain('createMobileTaskScreenStyles(theme)')
    expect(source).toContain('任务中心')
    expect(source).toContain('maxFontSizeMultiplier={1.3}')
    expect(source).toContain('productNameText(')
    expect(source).not.toContain("from '../../../src/tasks/MobileTasksLegacySurface'")
  })

  it('retains upstream task helpers without activating the unthemed legacy surface', () => {
    expect(MOBILE_TASKS_SOURCE_FILES).toContain(PRODUCT_ROUTE)
    expect(MOBILE_TASKS_SOURCE_FILES).toContain('MobileTasksLegacySurface.tsx')
    expect(MOBILE_TASKS_SOURCE_FILES).toContain('mobile-tasks-workspace-create-drawer.tsx')
    expect(MOBILE_TASKS_SOURCE_FILES).toContain('use-mobile-tasks-task-create-actions.tsx')
  })
})
