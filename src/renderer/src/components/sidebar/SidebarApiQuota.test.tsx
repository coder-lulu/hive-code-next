// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SidebarApiQuota } from './SidebarApiQuota'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import type { HiveAiAccountSnapshot } from '../../../../shared/hive-ai-account'

afterEach(cleanup)
const snapshot: HiveAiAccountSnapshot = {
  accountId: 'a',
  account: { status: 'ACTIVE', activationAvailable: false, asOf: '2026-09-22T00:00:00Z' },
  balance: {
    accountStatus: 'ACTIVE',
    availableQuota: '9007199254740993',
    usedQuota: '0',
    requestCount: '1',
    unit: 'POINTS',
    asOf: '2026-09-22T00:00:00Z',
    freshness: 'CURRENT'
  }
}
function install(read = vi.fn().mockResolvedValue(snapshot)) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { hiveAccount: { readAiAccount: read, onStateChanged: () => () => {} } }
  })
  return read
}
function view(accountId: string | null = 'a', onOpenDetails = vi.fn(), onSignIn = vi.fn()) {
  return (
    <DropdownMenu open>
      <DropdownMenuContent>
        <SidebarApiQuota accountId={accountId} onOpenDetails={onOpenDetails} onSignIn={onSignIn} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
it('does not read a balance while signed out and opens sign in', async () => {
  const read = install()
  const signIn = vi.fn()
  render(view(null, vi.fn(), signIn))
  fireEvent.click(await screen.findByText('Sign in to view'))
  expect(signIn).toHaveBeenCalledOnce()
  expect(read).not.toHaveBeenCalled()
})
it('preserves integer precision and opens account details', async () => {
  install()
  const details = vi.fn()
  render(view('a', details))
  fireEvent.click(await screen.findByText('9,007,199,254,740,993 points'))
  expect(details).toHaveBeenCalledOnce()
})
it('clears the old balance when a manual refresh fails and supports retry', async () => {
  const read = install()
  render(view())
  await screen.findByText('9,007,199,254,740,993 points')
  read.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh API balance' }))
  await screen.findByText('Unavailable')
  expect(screen.queryByText('9,007,199,254,740,993 points')).not.toBeInTheDocument()
  read.mockResolvedValueOnce({ ...snapshot, balance: { ...snapshot.balance, availableQuota: '0' } })
  fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh API balance' }))
  await screen.findByText('0 points')
  expect(read).toHaveBeenCalledTimes(3)
})
it('rejects a response belonging to another account', async () => {
  install(vi.fn().mockResolvedValue({ ...snapshot, accountId: 'other' }))
  render(view())
  await waitFor(() => expect(screen.getByText('Unavailable')).toBeInTheDocument())
  expect(screen.queryByText(/9,007/)).not.toBeInTheDocument()
})
it('shows unactivated accounts explicitly', async () => {
  install(
    vi.fn().mockResolvedValue({
      ...snapshot,
      account: { ...snapshot.account, status: 'NOT_PROVISIONED' },
      balance: null
    })
  )
  render(view())
  await screen.findByText('Not activated')
})
