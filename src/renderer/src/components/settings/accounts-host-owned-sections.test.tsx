// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountsPaneSectionModel } from './accounts-pane-types'

const mocks = vi.hoisted(() => ({ mounts: 0 }))
vi.mock('./ManagedDataAccountsSection', () => ({
  ManagedDataAccountsSection: ({ provider, target }: Record<string, unknown>) => {
    const [mount] = useState(() => ++mocks.mounts)
    return <div data-testid={String(provider)}>{JSON.stringify({ target, mount })}</div>
  }
}))
vi.mock('./AntigravityAccountsSection', () => ({
  AntigravityAccountsSection: (props: Record<string, unknown>) => {
    const [mount] = useState(() => ++mocks.mounts)
    return <div data-testid="antigravity">{JSON.stringify({ ...props, mount })}</div>
  }
}))
import { AccountsHostOwnedSections } from './accounts-host-owned-sections'

afterEach(() => {
  cleanup()
  mocks.mounts = 0
})
function model(patch: Partial<AccountsPaneSectionModel> = {}): AccountsPaneSectionModel {
  return {
    settings: {},
    accountScopeKey: 'local:host:',
    accountRuntime: { runtime: 'host', label: 'This device' },
    isRemoteAccountScope: false,
    accountRuntimeUnavailable: false,
    ...patch
  } as AccountsPaneSectionModel
}
function props(id: string): Record<string, unknown> {
  return JSON.parse(screen.getByTestId(id).textContent!) as Record<string, unknown>
}
describe('current account overview host-owned providers', () => {
  it('exposes all three completed providers using the actual local runtime owner', () => {
    render(<AccountsHostOwnedSections model={model()} />)
    expect(props('opencode').target).toEqual({ kind: 'local' })
    expect(props('devin').target).toEqual({ kind: 'local' })
    expect(props('antigravity')).toMatchObject({
      owner: { kind: 'local' },
      target: { runtime: 'host', wslDistro: null }
    })
  })
  it('remounts provider state when the account host changes', () => {
    const view = render(<AccountsHostOwnedSections model={model()} />)
    const before = props('opencode').mount
    view.rerender(
      <AccountsHostOwnedSections
        model={model({
          settings: {
            activeRuntimeEnvironmentId: 'server-2'
          } as AccountsPaneSectionModel['settings'],
          isRemoteAccountScope: true,
          accountScopeKey: 'environment:server-2:host:'
        })}
      />
    )
    expect(props('opencode').target).toEqual({ kind: 'environment', environmentId: 'server-2' })
    expect(props('opencode').mount).not.toBe(before)
    expect(props('antigravity').owner).toEqual({ kind: 'environment', environmentId: 'server-2' })
  })
  it('keeps WSL native accounts scoped to the distro and exposes managed accounts as unavailable', () => {
    render(
      <AccountsHostOwnedSections
        model={model({
          accountScopeKey: 'local:wsl:Ubuntu',
          accountRuntime: { runtime: 'wsl', wslDistro: 'Ubuntu', label: 'WSL Ubuntu' }
        })}
      />
    )
    expect(screen.queryByTestId('opencode')).toBeNull()
    expect(screen.queryByTestId('devin')).toBeNull()
    expect(props('antigravity').target).toEqual({ runtime: 'wsl', wslDistro: 'Ubuntu' })
    expect(screen.getByText(/unavailable for this WSL runtime/)).toBeTruthy()
  })
  it.each([{ isRemoteAccountScope: true }, { accountRuntimeUnavailable: true }])(
    'does not fall back to a local credential owner when scope is unavailable',
    (patch) => {
      render(<AccountsHostOwnedSections model={model(patch)} />)
      expect(screen.getByRole('alert').textContent).toBe('Accounts unavailable')
      expect(screen.queryByTestId('antigravity')).toBeNull()
      expect(mocks.mounts).toBe(0)
    }
  )
})
