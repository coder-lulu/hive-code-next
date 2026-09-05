import { describe, expect, it } from 'vitest'
import {
  MOBILE_TASKS_SOURCE_FILES,
  readMobileTasksSource
} from './mobile-tasks-source-family.test-support'

const PRODUCT_ROUTE = '../../app/h/[hostId]/tasks.tsx'

describe('Mobile Tasks product-boundary parity', () => {
  it('keeps the HiveCode Graphite task center as the active route', () => {
    const source = readMobileTasksSource(PRODUCT_ROUTE)
    const headerSource = readMobileTasksSource('MobileTasksHeader.tsx')
    const runtimeGateSource = readMobileTasksSource('MobileTaskRuntimeGate.tsx')
    const sourceTabsSource = readMobileTasksSource('MobileTasksSourceTabs.tsx')
    const runtimeSearchSource = readMobileTasksSource('MobileRuntimeTaskSearch.tsx')
    const executionViewSource = readMobileTasksSource('mobile-task-execution-view.ts')

    expect(source).toContain("from '../../../src/theme/mobile-theme-provider'")
    expect(source).toContain('const theme = useMobileTheme()')
    expect(source).toContain('createMobileTaskScreenStyles(theme)')
    expect(source).toContain("from '../../../src/tasks/MobileTasksHeader'")
    expect(source).toContain("from '../../../src/tasks/MobileTaskRuntimeGate'")
    expect(source).toContain("from '../../../src/tasks/MobileTasksPrimaryNavigation'")
    expect(source).toContain("from '../../../src/tasks/mobile-local-task-hook'")
    expect(source).toContain("from '../../../src/tasks/mobile-local-task-list'")
    expect(source).toContain("from '../../../src/tasks/MobileTasksSourceTabs'")
    expect(source).toContain("from '../../../src/tasks/MobileRuntimeTaskSearch'")
    expect(source).toContain("from '../../../src/tasks/mobile-task-execution-view'")
    expect(source).toContain('const localTaskFeed = useMobileLocalTasks(')
    expect(source).toContain('<MobileLocalTaskList')
    expect(source).toContain('<MobileTasksSourceTabs')
    expect(source).toContain('<MobileRuntimeTaskSearch')
    expect(source).toContain('projectMobileTaskExecutionView({')
    expect(sourceTabsSource).toContain("onSelectView('all')")
    expect(sourceTabsSource).toContain("onSelectView('local')")
    expect(sourceTabsSource).toContain('全部')
    expect(sourceTabsSource).toContain('本地')
    expect(executionViewSource).toContain("row.source === 'local'")
    expect(executionViewSource).toContain('mobileLocalTaskSourceLabel(row.source)')
    expect(executionViewSource).toContain('row.agentDisplayName')
    expect(executionViewSource).toContain('row.repo')
    expect(executionViewSource).toContain('row.branch')
    expect(runtimeSearchSource).toContain('筛选任务状态')
    expect(runtimeSearchSource).toContain("value: 'in-progress'")
    expect(runtimeSearchSource).toContain("value: 'recent-completed'")
    expect(headerSource).toContain('任务中心')
    expect(headerSource).toContain('maxFontSizeMultiplier={1.3}')
    expect(runtimeGateSource).toContain('productNameText(')
    expect(source).not.toContain("from '../../../src/tasks/MobileTasksLegacySurface'")
  })

  it('retains upstream task helpers without activating the unthemed legacy surface', () => {
    expect(MOBILE_TASKS_SOURCE_FILES).toContain(PRODUCT_ROUTE)
    expect(MOBILE_TASKS_SOURCE_FILES).toContain('MobileTasksLegacySurface.tsx')
    expect(MOBILE_TASKS_SOURCE_FILES).toContain('mobile-tasks-workspace-create-drawer.tsx')
    expect(MOBILE_TASKS_SOURCE_FILES).toContain('use-mobile-tasks-task-create-actions.tsx')
  })
})
