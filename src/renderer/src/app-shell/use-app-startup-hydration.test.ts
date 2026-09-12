// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchSettings: vi.fn(),
  fetchKeybindings: vi.fn().mockResolvedValue(undefined),
  fetchOrcaProfiles: vi.fn(),
  initGitHubCache: vi.fn(),
  publishAppearance: vi.fn(),
  recover: vi.fn()
}))
vi.mock('./use-app-startup-actions', () => ({ useStartupActions: () => mocks }))
vi.mock('../store', () => ({ useAppStore: { getState: () => ({ settings: {} }) } }))
vi.mock('@/lib/ui-zoom', () => ({}))
vi.mock('@/components/terminal-pane/codex-detached-pane-restart-scheduler', () => ({
  installCodexDetachedPaneRestartExecutor: () => () => {}
}))
vi.mock('./reconcile-hydrated-workspace-tab-models', () => ({}))
vi.mock('./restore-startup-terminal-session', () => ({}))
vi.mock('../store/slices/worktrees', () => ({}))
vi.mock('../lib/codex-stale-pane-sweep', () => ({}))
vi.mock('../lib/workspace-session-host-hydration', () => ({}))
vi.mock('../lib/workspace-session-hydration-keys', () => ({}))
vi.mock('../lib/startup-ui-hydration', () => ({}))
vi.mock('../startup/startup-diagnostics', () => ({
  logRendererStartupDiagnostic: () => {},
  timeRendererStartupStep: (_name: string, action: () => unknown) => action()
}))
vi.mock('../startup/startup-degraded-recovery', () => ({
  recoverFromDegradedStartup: mocks.recover
}))
vi.mock('../startup/startup-ssh-connection-restore', () => ({}))
vi.mock('../startup/active-workspace-ssh-targets', () => ({}))
vi.mock('../components/terminal-pane/terminal-appearance', () => ({
  publishTerminalViewAttributesAtAppStart: mocks.publishAppearance
}))
vi.mock('../lib/terminal-theme', () => ({ getSystemPrefersDark: () => false }))

import { useAppStartupHydration } from './use-app-startup-hydration'

it('stops an unmounted startup pass before further IPC and appearance publication', async () => {
  let resolveDiscarded!: () => void
  mocks.fetchSettings
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDiscarded = resolve
        })
    )
    .mockImplementationOnce(() => new Promise<void>(() => {}))
  const first = renderHook(() => useAppStartupHydration(() => {}))
  first.unmount()
  const { unmount } = renderHook(() => useAppStartupHydration(() => {}))
  expect(mocks.fetchSettings).toHaveBeenCalledTimes(2)
  await act(async () => {
    resolveDiscarded()
  })
  expect(mocks.publishAppearance).not.toHaveBeenCalled()
  expect(mocks.fetchKeybindings).not.toHaveBeenCalled()
  expect(mocks.initGitHubCache).not.toHaveBeenCalled()
  expect(mocks.recover).not.toHaveBeenCalled()
  unmount()
})
