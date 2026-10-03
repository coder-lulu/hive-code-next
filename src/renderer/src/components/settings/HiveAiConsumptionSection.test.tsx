// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HiveAiConsumptionSection } from './HiveAiConsumptionSection'
import { consumptionPageFixture } from '../../../../shared/hive-ai-consumption.test-fixture'
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback,
  getIntlLocale: () => 'en-US'
}))
afterEach(cleanup)
it('distinguishes service failure from an empty consumption range', async () => {
  const api = install()
  api.read.mockRejectedValueOnce(new Error('unavailable'))
  render(<HiveAiConsumptionSection accountId="owner" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Consumption records are unavailable')
  expect(screen.queryByText('No records in this range.')).not.toBeInTheDocument()
  api.read.mockImplementationOnce(async (query) => ({
    accountId: 'owner',
    history: { ...consumptionPageFixture, ...query, entries: [], reportedTotal: '0' }
  }))
  fireEvent.click(screen.getByText('Search records'))
  expect(await screen.findByText('No records in this range.')).toBeVisible()
  expect(screen.getByText('Next')).toBeDisabled()
})
function install() {
  const listeners = new Set<(value: unknown) => void>()
  const read = vi.fn().mockImplementation(async (query) => ({
    accountId: 'owner',
    history: { ...consumptionPageFixture, ...query, reportedTotal: '21' }
  }))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveAccount: {
        readAiConsumption: read,
        onStateChanged: (listener: (value: unknown) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        }
      }
    }
  })
  return { read, logout: () => listeners.forEach((listener) => listener({ status: 'signed-out' })) }
}
it('renders exact points and tokens and pages the accepted query', async () => {
  const api = install()
  render(<HiveAiConsumptionSection accountId="owner" />)
  expect(await screen.findByText('9,007,199,254,740,993')).toBeVisible()
  const initial = api.read.mock.calls[0][0]
  expect(Date.parse(initial.to) - Date.parse(initial.from)).toBe(7 * 86400000)
  expect(screen.getByText('9,223,372,036,854,775,807')).toBeVisible()
  fireEvent.click(screen.getByText('Last 30 days'))
  await waitFor(() => {
    const selected = api.read.mock.calls.at(-1)![0]
    expect(Date.parse(selected.to) - Date.parse(selected.from)).toBe(30 * 86400000)
  })
  await waitFor(() => expect(screen.getByText('Search records')).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Model (exact name)'), {
    target: { value: 'pending-edit' }
  })
  fireEvent.click(screen.getByText('Next'))
  await waitFor(() => expect(api.read.mock.calls.at(-1)?.[0].page).toBe(2))
  expect(api.read.mock.calls.at(-1)?.[0].model).toBeUndefined()
  await waitFor(() => expect(screen.getByText('Next')).toBeDisabled())
  fireEvent.click(screen.getByText('Search records'))
  await waitFor(() =>
    expect(api.read.mock.calls.at(-1)?.[0]).toMatchObject({ page: 1, model: 'pending-edit' })
  )
})
it('rejects invalid filters without querying or showing stale records', async () => {
  const api = install()
  render(<HiveAiConsumptionSection accountId="owner" />)
  await screen.findByText('9,007,199,254,740,993')
  fireEvent.change(screen.getByLabelText('Model (exact name)'), { target: { value: '*' } })
  fireEvent.click(screen.getByText('Search records'))
  expect(screen.getByRole('alert')).toHaveTextContent('Select up to 31 days')
  expect(screen.queryByText('9,007,199,254,740,993')).not.toBeInTheDocument()
  expect(api.read).toHaveBeenCalledOnce()
})
it('clears confirmed records on logout and ignores a late response', async () => {
  const api = install()
  render(<HiveAiConsumptionSection accountId="owner" />)
  await screen.findByText('9,007,199,254,740,993')
  let resolve!: (value: unknown) => void
  api.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  fireEvent.click(screen.getByText('Next'))
  await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
  act(api.logout)
  await act(async () =>
    resolve({
      accountId: 'owner',
      history: { ...consumptionPageFixture, ...api.read.mock.calls[1][0] }
    })
  )
  expect(screen.queryByText('9,007,199,254,740,993')).not.toBeInTheDocument()
})
