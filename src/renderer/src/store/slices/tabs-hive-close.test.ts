import { expect, it, vi } from 'vitest'
import { createTabsSliceMockApi } from './tabs-slice-test-harness'
import { createTestStore } from './store-test-helpers'
const mocks = vi.hoisted(() => ({ closeNative: vi.fn() }))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/runtime/structured-agent-session-tab-retirement', () => ({
  beginStructuredAgentSessionTabClose: mocks.closeNative
}))
createTabsSliceMockApi()
it('closes legacy Hive history without sending it to the Claude/Codex retirement API', () => {
  const store = createTestStore()
  const tab = store.getState().createUnifiedTab('global-floating-terminal', 'agent-session', {
    entityId: 'ha-session:owned',
    agentSessionAgent: 'hivecode',
    executionHostId: 'local'
  })
  expect(store.getState().closeUnifiedTab(tab.id)?.closedTabId).toBe(tab.id)
  expect(mocks.closeNative).not.toHaveBeenCalled()
})
