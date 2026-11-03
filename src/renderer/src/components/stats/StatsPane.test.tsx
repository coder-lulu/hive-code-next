// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AppState } from '../../store/types'
import { StatsPane } from './StatsPane'
const source = vi.hoisted(() => ({
  statsSummary: null,
  fetchStatsSummary: vi.fn().mockResolvedValue(undefined),
  recordFeatureInteraction: vi.fn()
}))
vi.mock('../../store', () => ({
  useAppStore: (selector: (state: Pick<AppState, keyof typeof source>) => unknown) =>
    selector(source)
}))
vi.mock('./UsageOverviewPane', () => ({
  UsageOverviewPane: ({ isActive }: { isActive: boolean }) => (
    <div>Overview active: {String(isActive)}</div>
  )
}))
vi.mock('./ClaudeUsagePane', () => ({ ClaudeUsagePane: () => null }))
vi.mock('./CodexUsagePane', () => ({ CodexUsagePane: () => null }))
vi.mock('./OpenCodeUsagePane', () => ({ OpenCodeUsagePane: () => null }))
vi.mock('./MuseUsagePane', () => ({ MuseUsagePane: () => null }))
vi.mock('./GrokUsagePane', () => ({ GrokUsagePane: () => null }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
it('forwards hidden state to the overview and fetches summary only when active', () => {
  const { rerender } = render(<StatsPane isActive={false} />)
  expect(screen.getByText('Overview active: false')).toBeTruthy()
  expect(source.fetchStatsSummary).not.toHaveBeenCalled()
  expect(source.recordFeatureInteraction).not.toHaveBeenCalled()
  rerender(<StatsPane isActive />)
  expect(screen.getByText('Overview active: true')).toBeTruthy()
  expect(source.fetchStatsSummary).toHaveBeenCalledOnce()
  expect(source.recordFeatureInteraction).toHaveBeenCalledWith('usage-tracking')
})
