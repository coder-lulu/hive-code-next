// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { RuntimeEnvironmentRemoveDialog } from './runtime-environment-dialogs'

afterEach(cleanup)
const environment: PublicKnownRuntimeEnvironment = {
  id: 'mixed-server',
  name: 'Cloud desk',
  createdAt: 1,
  updatedAt: 1,
  lastUsedAt: null,
  runtimeId: null,
  endpoints: [],
  preferredEndpointId: 'cloud',
  accessSources: ['account-claimed', 'local-pairing']
}
function renderRemove(pendingRemove = environment, removingActiveServer = false) {
  const onConfirm = vi.fn()
  render(
    <RuntimeEnvironmentRemoveDialog
      pendingRemove={pendingRemove}
      removingId={null}
      removeError={null}
      removingActiveServer={removingActiveServer}
      onOpenChange={vi.fn()}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />
  )
  return onConfirm
}
it('does not open local removal for an account-only runtime', () => {
  renderRemove({ ...environment, accessSources: ['account-claimed'] })
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('explains and confirms only local pairing removal for a mixed runtime', () => {
  const onConfirm = renderRemove()
  expect(screen.getByRole('dialog', { name: 'Remove Local Pairing' })).toBeTruthy()
  expect(
    screen.getByText(
      `This removes only the local pairing from ${APP_DISPLAY_NAME}. The server remains available through your account.`
    )
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove Local Pairing' }))
  expect(onConfirm).toHaveBeenCalledOnce()
})
it('keeps removal disabled for the selected default host', () => {
  const onConfirm = renderRemove(environment, true)
  const confirm = screen.getByRole('button', { name: 'Remove Local Pairing' })
  expect(confirm).toBeDisabled()
  fireEvent.click(confirm)
  expect(onConfirm).not.toHaveBeenCalled()
})

import { APP_DISPLAY_NAME } from '@/product-brand'
