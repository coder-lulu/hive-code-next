// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DailyIntensityGrid } from './usage-overview-sections'
afterEach(cleanup)
it('keeps the daily intensity title, describes selected sources, and cannot drill into missing days', () => {
  const onSelectDay = vi.fn()
  const base = {
    totalTokens: 10,
    claudeTokens: 10,
    codexTokens: 0,
    openCodeTokens: 0,
    museTokens: 0,
    intensity: 1 as const
  }
  render(
    <DailyIntensityGrid
      days={[
        { ...base, day: '2026-09-22' },
        { ...base, day: '2026-09-23', totalTokens: 0 }
      ]}
      bestDay={null}
      description="Claude"
      recordedDays={new Set(['2026-09-22'])}
      onSelectDay={onSelectDay}
    />
  )
  expect(screen.getByRole('heading', { name: 'Daily intensity' })).toBeInTheDocument()
  expect(screen.getByText('Claude')).toBeInTheDocument()
  const missing = screen.getByRole('button', { name: '2026-09-23: No recorded daily data' })
  expect(missing).toBeDisabled()
  fireEvent.click(missing)
  expect(onSelectDay).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '2026-09-22: 10 tokens' }))
  expect(onSelectDay).toHaveBeenCalledWith('2026-09-22')
})
