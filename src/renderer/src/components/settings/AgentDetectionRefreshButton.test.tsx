// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import { AgentDetectionRefreshButton } from './AgentDetectionRefreshButton'
import type { SettingsHostScope } from './settings-host-scope'

const detection = vi.hoisted(() => ({ observed: vi.fn(), refresh: vi.fn() }))
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: (target: AgentDetectionTarget | undefined) => {
    detection.observed(target)
    return { isRefreshing: false, refresh: () => detection.refresh(target) }
  }
}))
vi.mock('@/store', () => ({ useAppStore: () => null }))
vi.mock('@/lib/local-preflight-context', () => ({
  getLocalAgentPreflightContext: () => null,
  localPreflightContextKey: () => 'owned-local-context'
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
const settings = createGlobalSettingsFixture({ activeRuntimeEnvironmentId: 'default-a' })
function props(hostScope: SettingsHostScope) {
  return { settings, hostScope }
}
afterEach(cleanup)
beforeEach(() => {
  detection.observed.mockClear()
  detection.refresh.mockReset().mockResolvedValue([])
})
it('refreshes the selected settings host B while the project default remains A', () => {
  render(
    <AgentDetectionRefreshButton
      {...props({ target: { kind: 'environment', environmentId: 'chosen-b' }, available: true })}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Refresh detection' }))
  expect(detection.refresh).toHaveBeenCalledExactlyOnceWith({
    kind: 'runtime',
    environmentId: 'chosen-b'
  })
})
it('does not probe or refresh another host when the selected settings host is unavailable', () => {
  render(
    <AgentDetectionRefreshButton
      {...props({ target: { kind: 'environment', environmentId: 'missing-b' }, available: false })}
    />
  )
  const button = screen.getByRole('button', { name: 'Refresh detection' })
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(detection.observed).toHaveBeenLastCalledWith(undefined)
  fireEvent.click(button)
  expect(detection.refresh).not.toHaveBeenCalled()
})
it('uses the pane local context when local is explicitly selected over a remote default', () => {
  render(<AgentDetectionRefreshButton {...props({ target: { kind: 'local' }, available: true })} />)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh detection' }))
  expect(detection.refresh).toHaveBeenCalledExactlyOnceWith({
    kind: 'local',
    contextKey: 'owned-local-context'
  })
})
it('routes subsequent clicks to the newly selected settings host', () => {
  const { rerender } = render(
    <AgentDetectionRefreshButton
      {...props({ target: { kind: 'environment', environmentId: 'chosen-b' }, available: true })}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Refresh detection' }))
  rerender(
    <AgentDetectionRefreshButton
      {...props({ target: { kind: 'environment', environmentId: 'chosen-c' }, available: true })}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Refresh detection' }))
  expect(detection.refresh.mock.calls).toEqual([
    [{ kind: 'runtime', environmentId: 'chosen-b' }],
    [{ kind: 'runtime', environmentId: 'chosen-c' }]
  ])
})
