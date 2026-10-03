// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isWebClient: false,
  startRuntimeCloudSync: vi.fn(),
  stopRuntimeCloudSync: vi.fn()
}))

vi.mock('@/lib/web-client-location', () => ({
  isWebClientLocation: () => mocks.isWebClient
}))

vi.mock('@/lib/lazy-with-retry', () => ({
  lazyWithRetry: () => () => null
}))

vi.mock('../store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      workspaceSessionReady: true,
      startAccountRuntimeCloudSync: mocks.startRuntimeCloudSync,
      settings: {}
    })
}))

vi.mock('../components/AgentHibernationGate', () => ({
  AgentHibernationGate: () => null
}))

vi.mock('../components/AiVaultTabTitleSyncGate', () => ({
  AiVaultTabTitleSyncGate: () => null
}))

vi.mock('../components/dashboard/RetainedAgentsSyncGate', () => ({
  default: () => null
}))

vi.mock('../components/ports/WorkspacePortScanner', () => ({
  WorkspacePortScanner: () => null
}))

vi.mock('../hooks/MacosTccPromptNoticeHost', () => ({
  MacosTccPromptNoticeHost: () => null
}))

vi.mock('../components/native-chat/StructuredAgentSessionStatusBridge', () => ({
  StructuredAgentSessionStatusBridge: () => null
}))

vi.mock('../components/native-chat/StructuredAgentSessionAttentionBridge', () => ({
  StructuredAgentSessionAttentionBridge: () => null
}))

import { AppBackgroundServices } from './AppBackgroundServices'

const roots: Root[] = []

async function renderBackgroundServices(): Promise<Root> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<AppBackgroundServices />)
  })
  return root
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.isWebClient = false
  mocks.startRuntimeCloudSync.mockReset()
  mocks.stopRuntimeCloudSync.mockReset()
  mocks.startRuntimeCloudSync.mockReturnValue(mocks.stopRuntimeCloudSync)
})

afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe('AppBackgroundServices Runtime Cloud lifecycle', () => {
  it('starts and disposes desktop Runtime Cloud sync once', async () => {
    await renderBackgroundServices()

    expect(mocks.startRuntimeCloudSync).toHaveBeenCalledOnce()
    act(() => roots[0]?.unmount())
    roots.length = 0
    expect(mocks.stopRuntimeCloudSync).toHaveBeenCalledOnce()
  })

  it('does not install the desktop Runtime Cloud sync in the Web client', async () => {
    mocks.isWebClient = true

    await renderBackgroundServices()

    expect(mocks.startRuntimeCloudSync).not.toHaveBeenCalled()
  })
})
