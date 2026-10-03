// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HiveAiAccountSection } from './HiveAiAccountSection'
import { aiBenefitsFixture } from '../../../../shared/hive-ai-benefits.test-fixture'
import { useHiveAiRead } from './use-hive-ai-read'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, text: string) => text,
  getIntlLocale: () => 'en-US'
}))
afterEach(cleanup)
const snapshot = {
  accountId: 'a',
  account: { status: 'ACTIVE', activationAvailable: false, asOf: '2026-09-13T00:00:00Z' },
  balance: {
    accountStatus: 'ACTIVE',
    availableQuota: '9007199254740993',
    usedQuota: '0',
    requestCount: '1',
    freshness: 'CURRENT',
    unit: 'POINTS',
    asOf: '2026-09-13T00:00:00Z'
  }
}

const benefitsSnapshot = { accountId: 'a', account: snapshot.account, benefits: aiBenefitsFixture }
function install(
  read = vi.fn().mockResolvedValue(snapshot),
  readBenefits = vi.fn().mockResolvedValue(benefitsSnapshot),
  activate = vi.fn().mockResolvedValue({ accountId: 'a', account: snapshot.account })
) {
  const listeners = new Set<() => void>()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveAccount: {
        readAiAccount: read,
        readAiBenefits: readBenefits,
        activateAiAccount: activate,
        onStateChanged: (callback: () => void) => {
          listeners.add(callback)
          return () => listeners.delete(callback)
        }
      }
    }
  })
  return {
    read,
    readBenefits,
    activate,
    changed: () => listeners.forEach((callback) => callback())
  }
}

const inactive = (status = 'NOT_PROVISIONED') => ({
  accountId: 'a',
  account: { status, activationAvailable: true, asOf: snapshot.account.asOf },
  balance: null
})

it('ignores retained refresh and activation callbacks after the rendered owner changes', async () => {
  install()
  const replacement = { ...snapshot, accountId: 'b' }
  const read = vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValue(replacement)
  const mutation = vi.fn().mockResolvedValue({ accountId: 'b', account: snapshot.account })
  const view = renderHook(({ owner }) => useHiveAiRead(owner, read, mutation), {
    initialProps: { owner: 'a' }
  })
  await waitFor(() => expect(view.result.current.snapshot).toEqual(snapshot))
  const retained = view.result.current
  view.rerender({ owner: 'b' })
  await waitFor(() => expect(view.result.current.snapshot).toEqual(replacement))
  await act(async () => {
    await retained.activate()
    await retained.refresh()
  })
  expect(mutation).not.toHaveBeenCalled()
  expect(read).toHaveBeenCalledTimes(2)
  expect(view.result.current.snapshot).toEqual(replacement)
  expect(view.result.current.failed).toBe(false)
})

it('activates explicitly, blocks duplicate actions and refreshes wallet and plans after verification', async () => {
  let finish!: (value: unknown) => void
  const api = install(
    vi.fn().mockResolvedValueOnce(inactive()).mockResolvedValue(snapshot),
    vi
      .fn()
      .mockResolvedValueOnce({ ...inactive(), benefits: null })
      .mockResolvedValue(benefitsSnapshot),
    vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
  )
  render(<HiveAiAccountSection accountId="a" />)
  const button = await screen.findByRole('button', { name: 'Activate AI account' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  fireEvent.click(button)
  expect(button).toBeDisabled()
  const refresh = screen.getByRole('button', { name: 'Refresh AI balance' })
  expect(refresh).toBeDisabled()
  fireEvent.click(refresh)
  expect(api.activate).toHaveBeenCalledOnce()
  expect(api.read).toHaveBeenCalledOnce()
  await act(async () => finish({ accountId: 'a', account: snapshot.account }))
  expect(await screen.findAllByText('9,007,199,254,740,993')).toHaveLength(2)
  expect(api.read).toHaveBeenCalledTimes(2)
  expect(api.readBenefits).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: 'Activate AI account' })).not.toBeInTheDocument()
})

it('reads durable UNKNOWN after a lost activation without repeating the write', async () => {
  const api = install(
    vi.fn().mockResolvedValueOnce(inactive()).mockResolvedValue(inactive('UNKNOWN')),
    vi.fn().mockResolvedValue({ ...inactive('UNKNOWN'), benefits: null }),
    vi.fn().mockRejectedValue(new Error('lost response'))
  )
  render(<HiveAiAccountSection accountId="a" />)
  const button = await screen.findByRole('button', { name: 'Activate AI account' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed')
  expect(screen.getByRole('button', { name: 'Verify activation' })).toBeEnabled()
  expect(api.activate).toHaveBeenCalledOnce()
  expect(api.read).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('9,007,199,254,740,993')).not.toBeInTheDocument()
})

it.each([false, true])(
  'refreshes plans without waiting for the post-activation wallet (uncertain=%s)',
  async (uncertain) => {
    let rejectWallet!: (error: Error) => void
    const api = install(
      vi
        .fn()
        .mockResolvedValueOnce(inactive())
        .mockImplementation(
          () =>
            new Promise((_, reject) => {
              rejectWallet = reject
            })
        ),
      vi
        .fn()
        .mockResolvedValueOnce({ ...inactive(), benefits: null })
        .mockResolvedValue(benefitsSnapshot),
      uncertain ? vi.fn().mockRejectedValue(new Error('lost response')) : undefined
    )
    render(<HiveAiAccountSection accountId="a" />)
    const button = await screen.findByRole('button', { name: 'Activate AI account' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(api.readBenefits).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Monthly')).toBeVisible()
    expect(screen.getByText('vip')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Refresh AI balance' })).toBeDisabled()
    expect(api.activate).toHaveBeenCalledOnce()
    await act(async () => rejectWallet(new Error('wallet unavailable')))
    expect(screen.getByText('Monthly')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Refresh AI balance' })).toBeEnabled()
  }
)

it('discards activation after session removal and performs no follow-up reads for that session', async () => {
  let finish!: (value: unknown) => void
  const api = install(
    vi.fn().mockResolvedValue(inactive()),
    vi.fn().mockResolvedValue({ ...inactive(), benefits: null }),
    vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
  )
  render(<HiveAiAccountSection accountId="a" />)
  const button = await screen.findByRole('button', { name: 'Activate AI account' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  act(api.changed)
  await act(async () => finish({ accountId: 'a', account: snapshot.account }))
  expect(api.read).toHaveBeenCalledOnce()
  expect(api.readBenefits).toHaveBeenCalledOnce()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Activate AI account' })).not.toBeInTheDocument()
})

it('shows precise credits and cumulative units, and clears them on session change', async () => {
  const { changed } = install()
  render(<HiveAiAccountSection accountId="a" />)
  expect(await screen.findAllByText('9,007,199,254,740,993')).toHaveLength(2)
  expect(screen.getByText(/1 point = 1 New API quota unit. Points are not currency/)).toBeVisible()
  act(changed)
  expect(screen.queryByText('9,007,199,254,740,993')).not.toBeInTheDocument()
})

it('permits activation confirmed by the independent benefits read when the account read fails', async () => {
  const api = install(
    vi.fn().mockRejectedValue(new Error('account unavailable')),
    vi
      .fn()
      .mockResolvedValueOnce({ ...inactive(), benefits: null })
      .mockResolvedValue(benefitsSnapshot)
  )
  render(<HiveAiAccountSection accountId="a" />)
  const button = await screen.findByRole('button', { name: 'Activate AI account' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  expect(await screen.findByText('Monthly')).toBeVisible()
  expect(api.activate).toHaveBeenCalledOnce()
  expect(api.readBenefits).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: 'Activate AI account' })).not.toBeInTheDocument()
})

it('discards a previous owner reply and permits retry after failure', async () => {
  let release!: (value: typeof snapshot) => void
  const { read } = install(
    vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve
        })
      )
      .mockRejectedValueOnce(new Error('offline'))
  )
  const view = render(<HiveAiAccountSection accountId="a" />)
  view.rerender(<HiveAiAccountSection accountId="b" />)
  await act(async () => release(snapshot))
  expect(screen.queryByText('9,007,199,254,740,993')).not.toBeInTheDocument()
  await screen.findByText(/AI balance is unavailable/)
  read.mockResolvedValue({ ...snapshot, accountId: 'b' })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh AI balance' }))
  await waitFor(() => expect(screen.getByText('9,007,199,254,740,993')).toBeVisible())
})

it('distinguishes unknown from actual zero credit', async () => {
  const { read } = install(
    vi
      .fn()
      .mockResolvedValue({ ...snapshot, balance: { ...snapshot.balance, availableQuota: '0' } })
  )
  render(<HiveAiAccountSection accountId="a" />)
  await screen.findByText(
    'Your wallet points are insufficient. Plan points are accounted for separately.'
  )
  read.mockRejectedValue(new Error('unavailable'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh AI balance' }))
  await screen.findByText(/AI balance is unavailable/)
  expect(
    screen.queryByText(
      'Your wallet points are insufficient. Plan points are accounted for separately.'
    )
  ).not.toBeInTheDocument()
})

it('shows exact plan points, ID fallback, expiration and group separately from a failed wallet', async () => {
  install(vi.fn().mockRejectedValue(new Error('offline')))
  render(<HiveAiAccountSection accountId="a" />)
  expect(await screen.findByText('Monthly')).toBeVisible()
  expect(screen.getByText('vip')).toBeVisible()
  expect(screen.getByText('#8')).toBeVisible()
  expect(screen.getByText('expired')).toBeVisible()
  expect(screen.getByText('9,007,199,254,740,986')).toBeVisible()
  expect(screen.getAllByText('Next reset · UTC+08:00')).toHaveLength(2)
  expect(screen.queryByText('No plans')).not.toBeInTheDocument()
})
it('keeps verified wallets visible while benefits stall or fail', async () => {
  let reject!: (reason: Error) => void
  install(
    undefined,
    vi.fn().mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail
        })
    )
  )
  render(<HiveAiAccountSection accountId="a" />)
  expect(await screen.findByText('9,007,199,254,740,993')).toBeVisible()
  expect(screen.getByText('Loading group and plans…')).toBeVisible()
  await act(async () => reject(new Error('offline')))
  expect(screen.getByText('9,007,199,254,740,993')).toBeVisible()
  expect(screen.getByText('Plan information is unavailable. Refresh later.')).toBeVisible()
})
it('keeps verified plans visible while the wallet stalls and discards both after session removal', async () => {
  let release!: (value: typeof snapshot) => void
  const { changed } = install(
    vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
  )
  render(<HiveAiAccountSection accountId="a" />)
  expect(await screen.findByText('Monthly')).toBeVisible()
  act(changed)
  await act(async () => release(snapshot))
  expect(screen.queryByText('Monthly')).not.toBeInTheDocument()
  expect(screen.queryByText('9,007,199,254,740,993')).not.toBeInTheDocument()
})
it('hides confirmed wallet and plans when a benefits read reports disablement', async () => {
  install(
    undefined,
    vi.fn().mockResolvedValue({
      ...benefitsSnapshot,
      account: { ...snapshot.account, status: 'DISABLED' },
      benefits: null
    })
  )
  render(<HiveAiAccountSection accountId="a" />)
  expect(await screen.findByText('Your AI account is disabled. Contact support.')).toBeVisible()
  expect(screen.queryByText('9,007,199,254,740,993')).not.toBeInTheDocument()
  expect(screen.queryByText('Monthly')).not.toBeInTheDocument()
})
