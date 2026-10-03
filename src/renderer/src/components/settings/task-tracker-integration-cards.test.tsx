// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getExecutionHostLabel } from '../../../../shared/execution-host'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { TooltipProvider } from '../ui/tooltip'
import { LinearIntegrationCard } from './task-tracker-integration-cards'
import { IntegrationCardPresentationProvider } from './integration-card-presentation'
import { applyProductBranding } from '@/product-brand'

const LOCAL_HOST_LABEL = getExecutionHostLabel('local')

type StoreState = {
  linearStatus: {
    connected: boolean
    workspaces?: { id: string; organizationName: string; displayName: string; email?: string }[]
  }
  linearStatusError?: string | null
  linearStatusChecked: boolean
  linearStatusContextKey: string | null
  disconnectLinear: () => Promise<void>
  disconnectLinearWorkspace: (workspaceId?: string) => Promise<void>
  checkLinearConnection: (force?: boolean) => Promise<void>
  testLinearConnection: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>
  settings: { activeRuntimeEnvironmentId: string | null }
  openSettingsPage: () => void
  openSettingsTarget: (target: { pane: string; repoId: string | null }) => void
}

const mocks = vi.hoisted(() => ({
  store: { current: null as StoreState | null }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: StoreState) => unknown) => {
    if (!mocks.store.current) {
      throw new Error('Store state was not installed')
    }
    return selector(mocks.store.current)
  }
}))

vi.mock('@/components/linear-api-key-dialog', () => ({
  LinearApiKeyDialog: ({ onConnected }: { onConnected?: () => void }) => (
    <button type="button" data-testid="simulate-linear-connected" onClick={onConnected}>
      Simulate Linear connected
    </button>
  )
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function installStore(
  connected: boolean,
  settings: StoreState['settings'] = { activeRuntimeEnvironmentId: null }
): StoreState {
  const state: StoreState = {
    linearStatus: {
      connected,
      workspaces: connected
        ? [
            {
              id: 'workspace-1',
              organizationName: 'Acme',
              displayName: 'Acme workspace',
              email: 'linear@example.test'
            }
          ]
        : []
    },
    linearStatusChecked: true,
    linearStatusContextKey: getProviderRuntimeContextKey(settings),
    disconnectLinear: vi.fn(async () => {}),
    disconnectLinearWorkspace: vi.fn(async () => {}),
    checkLinearConnection: vi.fn(async () => {}),
    testLinearConnection: vi.fn(async () => ({ ok: true })),
    settings,
    openSettingsPage: vi.fn(),
    openSettingsTarget: vi.fn()
  }
  mocks.store.current = state
  return state
}

async function renderCard(list = false): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <TooltipProvider>
        <IntegrationCardPresentationProvider value={list ? 'settings-list' : 'default'}>
          <LinearIntegrationCard />
        </IntegrationCardPresentationProvider>
      </TooltipProvider>
    )
  })
  return container
}

describe('LinearIntegrationCard account scope', () => {
  beforeEach(() => {
    // Why: the embedded agent-skill CTA scans installed skills through
    // window.api; without a stub it renders a scan error instead of a state.
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        skills: { discover: async () => ({ skills: [], sources: [], scannedAt: 0 }) }
      }
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    mocks.store.current = null
    Reflect.deleteProperty(window, 'api')
  })

  it('keeps workspace tests manual and independent in the management drawer', async () => {
    const state = installStore(true)
    state.linearStatus.workspaces?.push({
      id: 'workspace-2',
      organizationName: 'Other',
      displayName: 'Other user'
    })
    vi.mocked(state.testLinearConnection).mockImplementation(async (id) =>
      id === 'workspace-1' ? { ok: false, error: 'Network unavailable' } : { ok: true }
    )
    const rendered = await renderCard(true)
    expect(state.testLinearConnection).not.toHaveBeenCalled()
    await act(async () => {
      rendered.querySelector('button')?.click()
    })
    const buttons = Array.from(document.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Test connection'
    )
    expect(buttons).toHaveLength(2)
    await act(async () => {
      buttons[0].click()
    })
    await act(async () => {
      buttons[1].click()
    })
    expect(state.testLinearConnection).toHaveBeenNthCalledWith(1, 'workspace-1')
    expect(state.testLinearConnection).toHaveBeenNthCalledWith(2, 'workspace-2')
    expect(document.body.textContent).toContain('Network unavailable')
    expect(document.body.textContent).toContain('Verified')
    expect(state.disconnectLinearWorkspace).not.toHaveBeenCalled()
    await act(async () => {
      Array.from(document.querySelectorAll('button'))
        .find((b) => b.textContent === 'Done')
        ?.click()
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('requires explicit confirmation before removing a workspace', async () => {
    const state = installStore(true)
    const rendered = await renderCard(true)
    await act(async () => {
      rendered.querySelector('button')?.click()
    })
    await act(async () => {
      document
        .querySelector('button[aria-label="More actions Acme"]')
        ?.dispatchEvent(
          new PointerEvent('pointerdown', { button: 0, ctrlKey: false, bubbles: true })
        )
    })
    const removeItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent === 'Remove access'
    )
    expect(removeItem).toBeDefined()
    await act(async () => {
      removeItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(state.disconnectLinearWorkspace).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Removing access does not delete issues in Linear.')
    await act(async () => {
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === 'Remove access')
        ?.click()
    })
    expect(state.disconnectLinearWorkspace).toHaveBeenCalledExactlyOnceWith('workspace-1')
  })

  it('does not claim an empty configuration when metadata is unavailable', async () => {
    const state = installStore(false)
    state.linearStatusError = 'Runtime offline'
    const rendered = await renderCard(true)
    await act(async () => {
      rendered.querySelector('button')?.click()
    })
    expect(document.body.textContent).toContain('Temporarily unavailable')
    expect(document.body.textContent).toContain('Runtime offline')
    expect(document.body.textContent).not.toContain('No workspace access configured.')
    const counts = Array.from(document.querySelectorAll('dt')).find(
      (node) => node.textContent === 'Workspaces'
    )
    expect(counts?.nextElementSibling?.textContent).toBe('—')
  })

  it('hides previous runtime workspace identities until the current status arrives', async () => {
    const state = installStore(true)
    state.settings = { activeRuntimeEnvironmentId: 'another-runtime' }
    const rendered = await renderCard(true)
    expect(rendered.textContent).toContain('Checking')
    await act(async () => {
      rendered.querySelector('button')?.click()
    })
    expect(document.body.textContent).not.toContain('Acme')
    expect(document.body.textContent).not.toContain('No workspace access configured.')
    expect(state.testLinearConnection).not.toHaveBeenCalled()
  })
  it('shows local-client account ownership when Linear is disconnected', async () => {
    const state = installStore(false)

    const rendered = await renderCard()

    expect(rendered.querySelector('[data-settings-section="integrations-linear"]')).not.toBeNull()
    expect(rendered.textContent).toContain(`Account scope: ${LOCAL_HOST_LABEL}`)
    expect(rendered.textContent).toContain(
      applyProductBranding(
        'Credentials and account checks for this provider are owned by this desktop client. Use Settings > Remote Orca Servers > Advanced to edit server-owned credentials.'
      )
    )
    expect(rendered.textContent).toContain('Open Remote Servers')
    expect(rendered.textContent).toContain('Add access with a Personal API key')

    await act(async () => {
      Array.from(rendered.querySelectorAll('button'))
        .find((button) => button.textContent === 'Re-check')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(state.checkLinearConnection).toHaveBeenCalledWith(true)
  })

  it('shows remote-server account ownership and connected workspace rows', async () => {
    const state = installStore(true, { activeRuntimeEnvironmentId: 'runtime-1' })

    const rendered = await renderCard()

    expect(rendered.textContent).toContain('Account scope: Remote server: runtime-1')
    expect(rendered.textContent).toContain(
      applyProductBranding(
        'Credentials and account checks for this provider are owned by this remote server. Use Settings > Remote Orca Servers > Advanced to edit another default runtime scope.'
      )
    )
    await act(async () => {
      Array.from(rendered.querySelectorAll('button'))
        .find((button) => button.textContent === 'Open Remote Servers')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(state.openSettingsPage).toHaveBeenCalledTimes(1)
    expect(state.openSettingsTarget).toHaveBeenCalledWith({
      pane: 'servers',
      repoId: null,
      sectionId: 'default-runtime'
    })
    expect(rendered.textContent).toContain('Acme')
    expect(rendered.textContent).toContain('Acme workspace · linear@example.test')

    await act(async () => {
      Array.from(rendered.querySelectorAll('button'))
        .find((button) => button.textContent === 'Test')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(state.testLinearConnection).toHaveBeenCalledWith('workspace-1')
  })

  it('clears verification state after adding another Linear workspace', async () => {
    installStore(true)
    const rendered = await renderCard()

    await act(async () => {
      Array.from(rendered.querySelectorAll('button'))
        .find((button) => button.textContent === 'Test')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(rendered.textContent).toContain('Verified')

    await act(async () => {
      rendered
        .querySelector<HTMLButtonElement>('[data-testid="simulate-linear-connected"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(rendered.textContent).not.toContain('Verified')
  })
})
