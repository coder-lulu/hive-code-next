// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { HiveRuntimePendingDisplayName } from '../../../../shared/hive-runtime-cloud'

type AliasDialogMocks = {
  updateDisplayName: ReturnType<typeof vi.fn>
  discard: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
  pending: HiveRuntimePendingDisplayName | null
}

const mocks = vi.hoisted((): AliasDialogMocks => ({
  updateDisplayName: vi.fn(),
  discard: vi.fn(),
  refresh: vi.fn(),
  pending: null
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      updateAccountRuntimeDisplayName: mocks.updateDisplayName,
      discardAccountRuntimeDisplayName: mocks.discard,
      refreshAccountRuntimeCloud: mocks.refresh,
      accountRuntimeDirectory: { pendingDisplayNames: mocks.pending ? [mocks.pending] : [] }
    })
}))
import { RuntimeCloudDisplayNameDialog } from './RuntimeCloudDisplayNameDialog'

const environment = {
  id: 'account-runtime:123e4567-e89b-42d3-a456-426614174000',
  name: 'Cloud desk',
  createdAt: 1,
  updatedAt: 1,
  lastUsedAt: null,
  runtimeId: null,
  runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
  endpoints: [],
  preferredEndpointId: 'cloud',
  accountClaim: {
    runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
    resourceVersion: 7,
    ownershipEpoch: 1,
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    lastHeartbeatAt: 1,
    freeDiskBytes: null,
    clientAuthMode: 'IDENTITY_PROOF',
    credentialState: 'ACTIVE',
    connectionCapabilities: ['hive-relay'],
    cloudConnectable: true,
    cloudDisplayName: 'Cloud desk',
    cloudDisplayNameVersion: 3
  }
} satisfies PublicKnownRuntimeEnvironment

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pending = null
  mocks.updateDisplayName.mockResolvedValue(undefined)
  mocks.discard.mockResolvedValue(undefined)
  mocks.refresh.mockResolvedValue(undefined)
})
afterEach(cleanup)

function pending(
  overrides: Partial<HiveRuntimePendingDisplayName> = {}
): HiveRuntimePendingDisplayName {
  return {
    runtimeRecordId: environment.runtimeRecordId,
    desiredName: 'My retained draft',
    revision: 9,
    expectedOwnershipEpoch: 1,
    expectedCloudDisplayNameVersion: 3,
    status: 'CONFLICT',
    errorCode: 'VERSION_CONFLICT',
    latestCloudDisplayName: 'Web desk',
    latestCloudDisplayNameVersion: 4,
    confirmedCloudDisplayNameVersion: null,
    retryNotBefore: null,
    ...overrides
  }
}
function refreshed() {
  return {
    ...environment,
    name: 'Web desk',
    accountClaim: {
      ...environment.accountClaim,
      cloudDisplayName: 'Web desk',
      cloudDisplayNameVersion: 4
    }
  }
}

function ExternalRenameDialog({ showOpener = true }: { showOpener?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {showOpener ? (
        <button type="button" onClick={() => setOpen(true)}>
          Rename current computer
        </button>
      ) : null}
      <RuntimeCloudDisplayNameDialog
        environment={open ? environment : null}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

describe('RuntimeCloudDisplayNameDialog', () => {
  it.each(['Escape', 'Close'])('returns focus to the external opener after %s', async (action) => {
    const user = userEvent.setup()
    render(<ExternalRenameDialog />)
    const opener = screen.getByRole('button', { name: 'Rename current computer' })
    await user.click(opener)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Runtime name' })).toHaveFocus())
    await (action === 'Escape'
      ? user.keyboard('{Escape}')
      : user.click(screen.getByRole('button', { name: 'Close' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
  })

  it('does not restore focus to an opener removed while the dialog was open', async () => {
    const user = userEvent.setup()
    const view = render(<ExternalRenameDialog />)
    const opener = screen.getByRole('button', { name: 'Rename current computer' })
    await user.click(opener)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Runtime name' })).toHaveFocus())
    const focus = vi.spyOn(opener, 'focus')
    view.rerender(<ExternalRenameDialog showOpener={false} />)
    expect(opener.isConnected).toBe(false)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(focus).not.toHaveBeenCalled()
  })

  it('starts from the confirmed alias and queues a normalized draft without announcing cloud success', async () => {
    const user = userEvent.setup(),
      onClose = vi.fn()
    render(<RuntimeCloudDisplayNameDialog environment={environment} onClose={onClose} />)
    const input = screen.getByRole('textbox', { name: 'Runtime name' })
    expect(input).toHaveValue('Cloud desk')
    await user.clear(input)
    await user.type(input, ' Cafe\u0301 ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocks.updateDisplayName).toHaveBeenCalledWith({
        runtimeRecordId: environment.runtimeRecordId,
        cloudDisplayName: 'Café',
        expectedOwnershipEpoch: 1,
        expectedCloudDisplayNameVersion: 3
      })
    )
    expect(screen.getByRole('status')).toHaveTextContent('Name change queued')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Cloud name confirmed')).not.toBeInTheDocument()
  })
  it('clears only the cloud alias with the frozen ownership and alias version', async () => {
    const user = userEvent.setup()
    render(<RuntimeCloudDisplayNameDialog environment={environment} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Clear cloud name' }))
    await waitFor(() =>
      expect(mocks.updateDisplayName).toHaveBeenCalledWith({
        runtimeRecordId: environment.runtimeRecordId,
        cloudDisplayName: null,
        expectedOwnershipEpoch: 1,
        expectedCloudDisplayNameVersion: 3
      })
    )
  })
  it('announces a queue failure with its field association and keeps the dialog available', async () => {
    mocks.updateDisplayName.mockRejectedValueOnce(new Error('queue full'))
    const user = userEvent.setup(),
      onClose = vi.fn()
    render(<RuntimeCloudDisplayNameDialog environment={environment} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
    expect(alert).toHaveTextContent('Could not save the Runtime name')
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-describedby', alert.id)
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('preserves a draft through refresh and requires explicit confirmation of the changed baseline', async () => {
    const user = userEvent.setup()
    const view = render(
      <RuntimeCloudDisplayNameDialog environment={environment} onClose={vi.fn()} />
    )
    const input = screen.getByRole('textbox', { name: 'Runtime name' })
    await user.clear(input)
    await user.type(input, 'Unsaved draft')
    view.rerender(<RuntimeCloudDisplayNameDialog environment={refreshed()} onClose={vi.fn()} />)
    expect(input).toHaveValue('Unsaved draft')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm submitting my draft' }))
    await waitFor(() =>
      expect(mocks.updateDisplayName).toHaveBeenCalledWith({
        runtimeRecordId: environment.runtimeRecordId,
        cloudDisplayName: 'Unsaved draft',
        expectedOwnershipEpoch: 1,
        expectedCloudDisplayNameVersion: 4
      })
    )
  })
  it('resets the draft only when targeting another Runtime', async () => {
    const user = userEvent.setup()
    const view = render(
      <RuntimeCloudDisplayNameDialog environment={environment} onClose={vi.fn()} />
    )
    const input = screen.getByRole('textbox', { name: 'Runtime name' })
    await user.clear(input)
    await user.type(input, 'Old Runtime draft')
    const id = '223e4567-e89b-42d3-a456-426614174000'
    view.rerender(
      <RuntimeCloudDisplayNameDialog
        environment={{
          ...environment,
          id,
          runtimeRecordId: id,
          name: 'Second Runtime',
          accountClaim: {
            ...environment.accountClaim,
            runtimeRecordId: id,
            cloudDisplayName: 'Second Runtime'
          }
        }}
        onClose={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Runtime name' })).toHaveValue('Second Runtime')
    )
  })
  it('reads a conflict again and can adopt the cloud name without writing the cloud', async () => {
    mocks.pending = pending()
    const user = userEvent.setup()
    render(<RuntimeCloudDisplayNameDialog environment={refreshed()} onClose={vi.fn()} />)
    expect(screen.getByRole('textbox')).toHaveValue('My retained draft')
    expect(screen.getByRole('status')).toHaveTextContent('The cloud name changed')
    await user.click(screen.getByRole('button', { name: 'Check cloud again' }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Discard draft and use cloud name' }))
    expect(mocks.discard).toHaveBeenCalledWith({
      runtimeRecordId: environment.runtimeRecordId,
      revision: 9
    })
    expect(screen.getByRole('textbox')).toHaveValue('Web desk')
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
  })
  it('creates a new conflict task only after confirmation and carries the exact old revision', async () => {
    mocks.pending = pending()
    const user = userEvent.setup()
    render(<RuntimeCloudDisplayNameDialog environment={refreshed()} onClose={vi.fn()} />)
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm submitting my draft' }))
    expect(mocks.updateDisplayName).toHaveBeenCalledWith({
      runtimeRecordId: environment.runtimeRecordId,
      cloudDisplayName: 'My retained draft',
      expectedOwnershipEpoch: 1,
      expectedCloudDisplayNameVersion: 4,
      pendingRevision: 9
    })
  })
  it('checks an unknown result with a read and never automatically resends it', async () => {
    mocks.pending = pending({ status: 'UNCONFIRMED', errorCode: 'RESULT_UNKNOWN' })
    const user = userEvent.setup()
    render(<RuntimeCloudDisplayNameDialog environment={environment} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Check cloud again' }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
  })
  it('keeps a migrated draft unbound until explicit confirmation creates a new epoch-bound task', async () => {
    mocks.pending = pending({
      status: 'BLOCKED',
      errorCode: 'OWNERSHIP_UNVERIFIED',
      expectedOwnershipEpoch: null
    })
    const user = userEvent.setup()
    render(<RuntimeCloudDisplayNameDialog environment={refreshed()} onClose={vi.fn()} />)
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Original ownership cannot be confirmed')
    await user.click(screen.getByRole('button', { name: 'Confirm submitting my draft' }))
    expect(mocks.updateDisplayName).toHaveBeenCalledWith(
      expect.objectContaining({ expectedOwnershipEpoch: 1, pendingRevision: 9 })
    )
  })
  it('disables duplicate writes while the durable task is submitting', () => {
    mocks.pending = pending({ status: 'SUBMITTING', errorCode: null })
    render(<RuntimeCloudDisplayNameDialog environment={environment} onClose={vi.fn()} />)
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Confirm submitting my draft' })).toBeDisabled()
    expect(mocks.updateDisplayName).not.toHaveBeenCalled()
  })
})
