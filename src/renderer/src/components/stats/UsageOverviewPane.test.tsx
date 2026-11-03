// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppState } from '../../store/types'
import type { UsageOverviewInput } from './usage-overview-types'
import type { MuseUsageSnapshot } from '../../../../shared/muse-usage-types'
import { TooltipProvider } from '../ui/tooltip'
import { UsageOverviewPane } from './UsageOverviewPane'

const query = vi.hoisted(() => vi.fn())
const source = vi.hoisted(() => ({
  fetchMuseUsage: vi.fn().mockResolvedValue(undefined),
  refreshMuseUsage: vi.fn().mockResolvedValue(undefined),
  museUsageScanState: null
}))
vi.mock('../../store', () => ({
  useAppStore: (selector: (state: Pick<AppState, keyof typeof source>) => unknown) =>
    selector(source)
}))
vi.mock('./use-usage-overview-query', () => ({ useUsageOverviewQuery: query }))

function overviewInput(): UsageOverviewInput {
  return {
    claude: {
      scanState: null,
      summary: {
        scope: 'all',
        range: '30d',
        sessions: 2,
        turns: 3,
        zeroCacheReadTurns: 0,
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheReuseRate: null,
        estimatedCostUsd: 0.1,
        hasUnpricedModels: false,
        topModel: null,
        topProject: null,
        hasAnyClaudeData: true
      },
      daily: [
        {
          day: '2026-11-01',
          inputTokens: 20,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        },
        {
          day: '2026-11-02',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        }
      ]
    },
    codex: {
      scanState: null,
      summary: {
        scope: 'all',
        range: '30d',
        sessions: 4,
        events: 5,
        inputTokens: 400,
        outputTokens: 100,
        cachedInputTokens: 200,
        reasoningOutputTokens: 50,
        totalTokens: 500,
        estimatedCostUsd: 0.2,
        hasUnpricedModels: false,
        topModel: null,
        topProject: null,
        hasAnyCodexData: true
      },
      daily: [
        {
          day: '2026-11-01',
          inputTokens: 40,
          outputTokens: 10,
          cachedInputTokens: 20,
          reasoningOutputTokens: 5,
          totalTokens: 50
        }
      ]
    },
    opencode: {
      scanState: null,
      summary: null,
      daily: [
        {
          day: '2026-11-01',
          inputTokens: 60,
          outputTokens: 10,
          cachedInputTokens: 20,
          reasoningOutputTokens: 5,
          totalTokens: 70
        }
      ]
    },
    muse: { scanState: null, summary: null, daily: [] }
  }
}

function museSnapshot(range: MuseUsageSnapshot['summary']['range'] = '30d'): MuseUsageSnapshot {
  return {
    scanState: {
      enabled: true,
      isScanning: false,
      lastScanStartedAt: null,
      lastScanCompletedAt: 1,
      lastScanError: null,
      hasAnyMuseData: true
    },
    summary: {
      scope: 'all',
      range,
      sessions: 1,
      events: 2,
      inputTokens: 80,
      outputTokens: 10,
      cachedInputTokens: 20,
      reasoningOutputTokens: 5,
      totalTokens: 90,
      topModel: null,
      topProject: null,
      hasAnyMuseData: true
    },
    daily: [
      {
        day: '2026-11-01',
        inputTokens: 80,
        outputTokens: 10,
        cachedInputTokens: 20,
        reasoningOutputTokens: 5,
        totalTokens: 90
      }
    ],
    modelBreakdown: [],
    projectBreakdown: [],
    recentSessions: []
  }
}
const getMuseSnapshot = vi.fn()
function view(active = true) {
  return (
    <TooltipProvider>
      <UsageOverviewPane isActive={active} />
    </TooltipProvider>
  )
}
function detailsRow(agent: string) {
  return within(screen.getByRole('row', { name: new RegExp(`^${agent} `) }))
}
function choose(label: string, name: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' })
  fireEvent.click(screen.getByRole('option', { name }))
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 2, 12))
  query.mockReturnValue({ data: overviewInput(), loading: false, error: false, refresh: vi.fn() })
  getMuseSnapshot.mockReset().mockResolvedValue(museSnapshot())
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { museUsage: { getSnapshot: getMuseSnapshot } }
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('drills into real daily counts for all four sources and clears back to range totals', async () => {
  render(view())
  await waitFor(() => expect(detailsRow('Muse').getByText('90')).toBeInTheDocument())
  const heatmap = within(screen.getByLabelText('Recent token activity heatmap'))
  expect(heatmap.getAllByRole('button')).toHaveLength(30)
  expect(heatmap.getByRole('button', { name: '2026-10-31: No recorded daily data' })).toBeDisabled()
  expect(heatmap.getByRole('button', { name: '2026-11-02: 0 tokens' })).toBeEnabled()
  fireEvent.click(heatmap.getByRole('button', { name: '2026-11-01: 240 tokens' }))
  for (const [agent, tokens] of [
    ['Claude', '30'],
    ['Codex', '50'],
    ['OpenCode', '70'],
    ['Muse', '90']
  ]) {
    const row = detailsRow(agent)
    expect(row.getByText(tokens)).toBeInTheDocument()
    expect(row.getAllByText('—')).toHaveLength(2)
  }
  fireEvent.click(screen.getByRole('button', { name: 'Cumulative' }))
  expect(screen.getByRole('button', { name: 'Cumulative' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Clear selected day' }))
  expect(detailsRow('Claude').getByText('300')).toBeInTheDocument()
  expect(detailsRow('Codex').getByText('500')).toBeInTheDocument()
  expect(detailsRow('Codex').getByText('4')).toBeInTheDocument()
})

it('clears a day when agent or range changes and keeps range while hidden', async () => {
  const { rerender } = render(view())
  await waitFor(() =>
    expect(getMuseSnapshot).toHaveBeenCalledWith({ scope: 'all', range: '30d', limit: 100 })
  )
  fireEvent.click(
    within(screen.getByLabelText('Recent token activity heatmap')).getByRole('button', {
      name: '2026-11-01: 240 tokens'
    })
  )
  choose('Agent', 'Claude')
  expect(screen.queryByRole('button', { name: 'Clear selected day' })).not.toBeInTheDocument()
  expect(detailsRow('Claude').getByText('300')).toBeInTheDocument()
  expect(screen.queryByRole('row', { name: /^Codex / })).not.toBeInTheDocument()
  fireEvent.click(
    within(screen.getByLabelText('Recent token activity heatmap')).getByRole('button', {
      name: '2026-11-01: 30 tokens'
    })
  )
  choose('Time range', 'Last 7 days')
  expect(screen.queryByRole('button', { name: 'Clear selected day' })).not.toBeInTheDocument()
  await waitFor(() =>
    expect(getMuseSnapshot).toHaveBeenLastCalledWith({ scope: 'all', range: '7d', limit: 100 })
  )
  expect(
    within(screen.getByLabelText('Recent token activity heatmap')).getAllByRole('button')
  ).toHaveLength(7)
  rerender(view(false))
  expect(query).toHaveBeenLastCalledWith('7d', false)
  const calls = getMuseSnapshot.mock.calls.length
  rerender(view(true))
  expect(query).toHaveBeenLastCalledWith('7d', true)
  await waitFor(() => expect(getMuseSnapshot).toHaveBeenCalledTimes(calls + 1))
})

it('reports unavailable Muse data and drops a late snapshot after range change', async () => {
  const pending = Promise.withResolvers<MuseUsageSnapshot | null>()
  getMuseSnapshot.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(null)
  render(view())
  choose('Time range', 'Last 7 days')
  await screen.findByText('Muse usage is unavailable on this host.')
  await act(async () => {
    pending.resolve(museSnapshot())
    await pending.promise
  })
  expect(screen.getByText('Muse usage is unavailable on this host.')).toBeInTheDocument()
  expect(detailsRow('Muse').getAllByRole('cell')[1]).toHaveTextContent('0')
})

it('keeps hidden Muse requests idle and reports a missing host snapshot API', async () => {
  Object.defineProperty(window, 'api', { configurable: true, value: {} })
  const { rerender } = render(view(false))
  expect(source.fetchMuseUsage).not.toHaveBeenCalled()
  expect(getMuseSnapshot).not.toHaveBeenCalled()
  rerender(view(true))
  await screen.findByText('Muse usage is unavailable on this host.')
  expect(source.fetchMuseUsage).toHaveBeenCalledOnce()
  expect(screen.getByTestId('usage-overview-pane')).toHaveAttribute('aria-busy', 'false')
})
