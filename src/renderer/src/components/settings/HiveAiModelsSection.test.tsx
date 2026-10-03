// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../shared/hive-account'
import { modelCandidatesFixture as catalog } from '../../../../shared/hive-ai-model-candidates.test-fixture'
import { HiveAiModelsSection } from './HiveAiModelsSection'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, text: string) => text,
  getIntlLocale: () => 'en-US'
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function install(read = vi.fn().mockResolvedValue({ accountId: 'a', catalog })) {
  let changed = (_state: HiveAccountState) => {}
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveAccount: {
        readAiModelCandidates: read,
        onStateChanged: (callback: (state: HiveAccountState) => void) => {
          changed = callback
          return () => {}
        }
      }
    }
  })
  return {
    read,
    changed: (
      state: HiveAccountState = { configured: true, status: 'signed-out', persistence: 'none' }
    ) => changed(state)
  }
}
const refreshedState: HiveAccountState = {
  configured: true,
  status: 'signed-in',
  persistence: 'encrypted',
  account: { accountId: 'a', displayName: 'A' },
  expiresAt: Date.now() + 60_000
}
it('reloads prices after a healthy credential refresh for the same account', async () => {
  const { read, changed } = install()
  render(<HiveAiModelsSection accountId="a" />)
  await screen.findByText('model-plain')
  await act(async () => changed(refreshedState))
  expect(await screen.findByText('model-plain')).toBeVisible()
  expect(read).toHaveBeenCalledTimes(2)
})
it('waits until foreground to reload refreshed credentials', async () => {
  const { read, changed } = install()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  render(<HiveAiModelsSection accountId="a" />)
  await screen.findByText('model-plain')
  visibility.mockReturnValue('hidden')
  fireEvent(document, new Event('visibilitychange'))
  await act(async () => changed(refreshedState))
  expect(read).toHaveBeenCalledOnce()
  visibility.mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  expect(await screen.findByText('model-plain')).toBeVisible()
  expect(read).toHaveBeenCalledTimes(2)
})
it('discards the old in-flight response after credentials rotate', async () => {
  let release!: (value: { accountId: string; catalog: typeof catalog }) => void
  const { read, changed } = install(
    vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve
        })
      )
      .mockResolvedValueOnce({ accountId: 'a', catalog: { ...catalog, models: [] } })
  )
  render(<HiveAiModelsSection accountId="a" />)
  await act(async () => changed(refreshedState))
  expect(await screen.findByText('No reference models are available.')).toBeVisible()
  await act(async () => release({ accountId: 'a', catalog }))
  expect(screen.queryByText('model-plain')).not.toBeInTheDocument()
  expect(read).toHaveBeenCalledTimes(2)
})
it.each([
  { configured: true, status: 'signed-out' as const, persistence: 'none' as const },
  { ...refreshedState, account: { accountId: 'b', displayName: 'B' } },
  { ...refreshedState, errorCode: 'session_expired' as const },
  { ...refreshedState, errorCode: 'session_rejected' as const },
  { ...refreshedState, expiresAt: 1 }
])(
  'keeps invalid session updates fenced across foreground and manual refresh: %j',
  async (state) => {
    const { read, changed } = install()
    render(<HiveAiModelsSection accountId="a" />)
    await screen.findByText('model-plain')
    await act(async () => changed(state))
    fireEvent(document, new Event('visibilitychange'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh AI model prices' }))
    expect(read).toHaveBeenCalledOnce()
    expect(screen.queryByText('model-plain')).not.toBeInTheDocument()
  }
)
it('shows exact reference rates, missing values and tiered billing without model selection', async () => {
  install()
  render(<HiveAiModelsSection accountId="a" />)
  expect(await screen.findByText('9,007,199,254,740,993.123456789012')).toBeVisible()
  expect(screen.getByText('0')).toBeVisible()
  expect(screen.getAllByText('—')).toHaveLength(5)
  expect(screen.getByText(/Tiered billing/)).toBeVisible()
  expect(screen.getAllByText('Reference')).toHaveLength(2)
  expect(screen.getByText(/Reference group rates/)).toBeVisible()
  expect(screen.getAllByRole('button')).toHaveLength(1)
})
it('clears prices on auth change and rejects previous owner replies', async () => {
  let release!: (value: { accountId: string; catalog: typeof catalog }) => void
  const { changed } = install(
    vi.fn().mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
  )
  render(<HiveAiModelsSection accountId="a" />)
  act(changed)
  await act(async () => release({ accountId: 'a', catalog }))
  expect(screen.queryByText('model-plain')).not.toBeInTheDocument()
  expect(screen.getByText(/Model prices are unavailable/)).toBeVisible()
})
it('permits retry and distinguishes an empty catalog from failure', async () => {
  const { read } = install(vi.fn().mockRejectedValue(new Error('private')))
  render(<HiveAiModelsSection accountId="a" />)
  await screen.findByText(/Model prices are unavailable/)
  read.mockResolvedValue({ accountId: 'a', catalog: { ...catalog, models: [] } })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh AI model prices' }))
  expect(await screen.findByText('No reference models are available.')).toBeVisible()
})
it('hides prices while backgrounded and refreshes on foreground', async () => {
  const { read } = install()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  render(<HiveAiModelsSection accountId="a" />)
  await screen.findByText('model-plain')
  visibility.mockReturnValue('hidden')
  fireEvent(document, new Event('visibilitychange'))
  expect(screen.queryByText('model-plain')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh AI model prices' }))
  expect(read).toHaveBeenCalledOnce()
  visibility.mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  await screen.findByText('model-plain')
  expect(read).toHaveBeenCalledTimes(2)
})
