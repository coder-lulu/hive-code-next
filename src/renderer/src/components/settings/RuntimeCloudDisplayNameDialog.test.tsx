// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateDisplayName: vi.fn(),
  success: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ updateAccountRuntimeDisplayName: mocks.updateDisplayName })
}))
vi.mock('sonner', () => ({ toast: { success: mocks.success } }))

import { RuntimeCloudDisplayNameDialog } from './RuntimeCloudDisplayNameDialog'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'

const environment = {
  id: 'account-runtime:123e4567-e89b-42d3-a456-426614174000',
  name: 'Pending desk',
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
  mocks.updateDisplayName.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('RuntimeCloudDisplayNameDialog', () => {
  it('starts from the effective catalog name and sends a normalized alias through the store', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<RuntimeCloudDisplayNameDialog environment={environment} onClose={onClose} />)
    const input = screen.getByRole('textbox', { name: 'Runtime name' })

    expect(input).toHaveValue('Pending desk')
    await user.clear(input)
    await user.type(input, ' Cafe\u0301 ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mocks.updateDisplayName).toHaveBeenCalledWith({
        runtimeRecordId: environment.runtimeRecordId,
        cloudDisplayName: 'Café',
        expectedCloudDisplayNameVersion: 3
      })
    )
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('queued'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clears only the cloud alias with the current concurrency version', async () => {
    const user = userEvent.setup()
    render(<RuntimeCloudDisplayNameDialog environment={environment} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Clear cloud name' }))

    await waitFor(() =>
      expect(mocks.updateDisplayName).toHaveBeenCalledWith({
        runtimeRecordId: environment.runtimeRecordId,
        cloudDisplayName: null,
        expectedCloudDisplayNameVersion: 3
      })
    )
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('queued'))
  })

  it('announces a queue failure and keeps the dialog available for retry', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mocks.updateDisplayName.mockRejectedValueOnce(new Error('queue full'))
    render(<RuntimeCloudDisplayNameDialog environment={environment} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
    expect(alert).toHaveTextContent('Could not save the Runtime name')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('preserves an in-progress draft when the same Runtime directory entry refreshes', async () => {
    const user = userEvent.setup()
    const view = render(
      <RuntimeCloudDisplayNameDialog environment={environment} onClose={vi.fn()} />
    )
    const input = screen.getByRole('textbox', { name: 'Runtime name' })
    await user.clear(input)
    await user.type(input, 'Unsaved draft')

    view.rerender(
      <RuntimeCloudDisplayNameDialog
        environment={{
          ...environment,
          name: 'Directory refresh name',
          accountClaim: { ...environment.accountClaim, cloudDisplayNameVersion: 9 }
        }}
        onClose={vi.fn()}
      />
    )

    expect(input).toHaveValue('Unsaved draft')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocks.updateDisplayName).toHaveBeenCalledWith({
        runtimeRecordId: environment.runtimeRecordId,
        cloudDisplayName: 'Unsaved draft',
        expectedCloudDisplayNameVersion: 9
      })
    )
  })

  it('resets the draft when the dialog target changes to a different Runtime', async () => {
    const user = userEvent.setup()
    const view = render(
      <RuntimeCloudDisplayNameDialog environment={environment} onClose={vi.fn()} />
    )
    const input = screen.getByRole('textbox', { name: 'Runtime name' })
    await user.clear(input)
    await user.type(input, 'Old Runtime draft')
    const nextRuntimeRecordId = '223e4567-e89b-42d3-a456-426614174000'

    view.rerender(
      <RuntimeCloudDisplayNameDialog
        environment={{
          ...environment,
          id: `account-runtime:${nextRuntimeRecordId}`,
          name: 'Second Runtime',
          runtimeRecordId: nextRuntimeRecordId,
          accountClaim: {
            ...environment.accountClaim,
            runtimeRecordId: nextRuntimeRecordId
          }
        }}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(input).toHaveValue('Second Runtime'))
  })
})
