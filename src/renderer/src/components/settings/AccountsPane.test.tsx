import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { i18n } from '../../i18n/i18n'
import { useAppStore } from '../../store'
import { AccountsPane } from './AccountsPane'

function renderPane(
  settings: GlobalSettings,
  props: Partial<React.ComponentProps<typeof AccountsPane>> = {}
): string {
  return renderToStaticMarkup(
    React.createElement(AccountsPane, {
      settings,
      updateSettings: vi.fn(),
      ...props
    })
  )
}

describe('AccountsPane', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useAppStore.setState({ settingsSearchQuery: '', runtimeEnvironments: [] })
  })

  it('hides the WSL account location controls on platforms without WSL support', () => {
    const markup = renderPane({
      ...getDefaultSettings('/tmp'),
      localAccountRuntime: 'wsl'
    })

    expect(markup).not.toContain('aria-label="Account location"')
    expect(markup).not.toContain('aria-label="Account location"')
    expect(markup).not.toContain('WSL is not available on this machine.')
  })

  it('keeps the WSL account location controls on Windows-class hosts', () => {
    const markup = renderPane(
      {
        ...getDefaultSettings('/tmp'),
        localAccountRuntime: 'wsl'
      },
      { wslSupportedPlatform: true, wslCapabilitiesLoading: true }
    )

    expect(markup).toContain('CLI accounts')
    expect(markup).toContain('aria-label="Account location"')
    expect(markup).toContain('role="radio" aria-checked="true" aria-disabled="true"')
  })

  it('renders the designed official, CLI, and credential groups', () => {
    const markup = renderPane(getDefaultSettings('/tmp'))

    expect(markup).toContain('Official service')
    expect(markup).toContain('CLI accounts')
    expect(markup).toContain('Credentials &amp; usage')
    expect(markup).toContain('Claude')
    expect(markup).toContain('Codex')
    expect(markup).toContain('Gemini')
    expect(markup).toContain('OpenCode Go')
    expect(markup).toContain('MiniMax')
    expect(markup).toContain('Grok')
  })

  it('does not report a fake zero account count before provider rosters load', () => {
    const markup = renderPane(getDefaultSettings('/tmp'))

    expect(markup).toContain('Loading accounts')
    expect(markup).not.toContain('Added accounts 0')
  })

  it('selects the WSL account location under auto when the global project runtime is WSL', () => {
    // Why: navigator.userAgent is a read-only prototype getter, so shadow it with
    // a configurable own property and remove that shadow afterward to restore it.
    const originalOwnUserAgent = Object.getOwnPropertyDescriptor(globalThis.navigator, 'userAgent')
    Object.defineProperty(globalThis.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      configurable: true
    })
    try {
      const markup = renderPane(
        {
          ...getDefaultSettings('/tmp'),
          localAccountRuntime: 'auto',
          localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu' }
        },
        { wslSupportedPlatform: true, wslCapabilitiesLoading: true }
      )

      expect(markup).toContain('aria-label="Account location"')
      // The resolved WSL radio is the checked option (unavailable while capabilities load).
      expect(markup).toContain('role="radio" aria-checked="true" aria-disabled="true"')
    } finally {
      if (originalOwnUserAgent) {
        Object.defineProperty(globalThis.navigator, 'userAgent', originalOwnUserAgent)
      } else {
        delete (globalThis.navigator as { userAgent?: string }).userAgent
      }
    }
  })

  it('keeps the runtime label inside the localized account copy', () => {
    const markup = renderPane(getDefaultSettings('/tmp'))

    expect(markup).toContain('This device')
    expect(markup).toContain('Local This device · CLI OAuth')
    expect(markup).not.toContain('LocalThis device')
  })

  it('localizes the runtime label before interpolating account copy', async () => {
    await i18n.changeLanguage('es')

    const markup = renderPane(getDefaultSettings('/tmp'))

    expect(markup).toMatch(/[Ee]ste dispositivo/)
    expect(markup).not.toContain('This device')
  })

  it('scopes account copy to the active remote server and disables local sign-in actions', () => {
    // Note: static SSR markup reads the store's initial state (zustand v5), so
    // this exercises the pre-hydration path where no server name is known yet.
    // The named-server label is covered in provider-account-scope.test.ts.
    const markup = renderPane(
      {
        ...getDefaultSettings('/tmp'),
        activeRuntimeEnvironmentId: 'env-1'
      },
      { wslSupportedPlatform: true }
    )

    expect(markup).toContain('the remote server')
    expect(markup).toContain('Account location')
    // The WSL account-location toggle is a local concern; a remote owner hides it.
    expect(markup).not.toContain('aria-label="Account location"')
    expect(markup).toContain('Manage accounts')
  })

  it('omits the scope control on the web client, which cannot select Local desktop', () => {
    const webGlobal = globalThis as { window?: { __ORCA_WEB_CLIENT__?: boolean } }
    const hadWindow = 'window' in webGlobal
    webGlobal.window = { ...webGlobal.window, __ORCA_WEB_CLIENT__: true }
    try {
      const markup = renderPane({
        ...getDefaultSettings('/tmp'),
        activeRuntimeEnvironmentId: 'env-1'
      })

      expect(markup).not.toContain('Accounts managed on this desktop are unchanged')
      expect(markup).not.toContain('Open Remote Servers')
      expect(markup).toContain('the remote server')
    } finally {
      if (!hadWindow) {
        delete webGlobal.window
      }
    }
  })

  it('keeps local copy and enabled sign-in actions when no remote server is active', () => {
    const markup = renderPane(getDefaultSettings('/tmp'))

    expect(markup).toContain('This device')
    expect(markup).not.toContain('Open Remote Servers')
    const manageIndex = markup.indexOf('Manage accounts')
    expect(manageIndex).toBeGreaterThan(0)
    expect(markup.slice(markup.lastIndexOf('<button', manageIndex), manageIndex)).not.toContain(
      'disabled=""'
    )
  })
})
