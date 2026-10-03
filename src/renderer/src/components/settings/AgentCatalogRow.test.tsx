// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentCatalogRow, type AgentCatalogRowProps } from './AgentCatalogRow'
import { TooltipProvider } from '../ui/tooltip'

vi.mock('./AgentInstallationDetails', () => ({
  AgentInstallationDetails: () => <section data-testid="installation-review" />
}))

const props: AgentCatalogRowProps = {
  installationTarget: { environmentId: null, platform: 'win32', wslDistro: null },
  agentId: 'codex',
  label: 'Codex',
  homepageUrl: 'https://github.com/openai/codex',
  defaultCmd: 'codex',
  defaultArgs: '',
  defaultEnv: {},
  isDetected: true,
  isEnabled: true,
  isDefault: false,
  cmdOverride: undefined,
  argsOverride: '',
  envOverride: {},
  onSetDefault: () => {},
  onSetEnabled: () => {},
  onSaveOverride: () => {},
  onSaveArgs: () => {},
  onSaveEnv: () => {},
  versionSnapshot: {
    current: { status: 'ready', version: '1.2.3' },
    latest: {
      status: 'ready',
      version: '1.2.4',
      packageName: '@openai/codex',
      channel: 'npm-latest'
    },
    currentLoading: false,
    latestLoading: false
  }
}

function renderCard(updates: Partial<AgentCatalogRowProps> = {}) {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(
    <TooltipProvider>
      <AgentCatalogRow {...props} {...updates} />
    </TooltipProvider>
  )
  return container
}

describe('agent maintenance actions', () => {
  afterEach(cleanup)
  it('keeps installation diagnostics available when command detection fails', () => {
    render(
      <TooltipProvider>
        <AgentCatalogRow {...props} isDetected={false} />
      </TooltipProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Installation details' }))
    expect(screen.getByTestId('installation-review')).toBeTruthy()
  })
  it('offers the next upgrade after checking updates without clearing the earlier success feedback', () => {
    const onUpgrade = vi.fn()
    const installation = {
      action: 'upgrade' as const,
      installing: false,
      result: { status: 'installed' as const, version: '1.2.4', previousVersion: '1.2.3' }
    }
    const versionSnapshot = {
      ...props.versionSnapshot!,
      current: { status: 'ready' as const, version: '1.2.4' }
    }
    const { rerender } = render(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          onUpgrade={onUpgrade}
          installation={installation}
          versionSnapshot={versionSnapshot}
        />
      </TooltipProvider>
    )
    expect(screen.queryByRole('button', { name: 'Upgrade Codex' })).toBeNull()
    rerender(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          onUpgrade={onUpgrade}
          installation={installation}
          versionSnapshot={{
            ...versionSnapshot,
            latest: { ...versionSnapshot.latest!, version: '1.2.5' }
          }}
        />
      </TooltipProvider>
    )
    const button = screen.getByRole('button', { name: 'Upgrade Codex' })
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.querySelector('span.inline-grid > span:not([aria-hidden])')?.textContent).toBe(
      'Upgrade'
    )
    expect(screen.getByRole('status').textContent).toContain('1.2.3 →1.2.4')
    fireEvent.click(button)
    expect(onUpgrade).not.toHaveBeenCalled()
    expect(screen.getByTestId('installation-review')).toBeTruthy()
  })

  it('allows another self-upgrade when the upstream has no version metadata', () => {
    const onUpgrade = vi.fn()
    render(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          onUpgrade={onUpgrade}
          installation={{
            action: 'upgrade',
            installing: false,
            result: { status: 'installed', version: '1.2.3' }
          }}
          versionSnapshot={{
            ...props.versionSnapshot!,
            latest: { status: 'unsupported', version: null, channel: 'npm-latest' }
          }}
        />
      </TooltipProvider>
    )
    const button = screen.getByRole('button', { name: 'Upgrade Codex' })
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    expect(onUpgrade).not.toHaveBeenCalled()
    expect(screen.getByTestId('installation-review')).toBeTruthy()
  })

  it('allows reinstalling an agent that is no longer detected despite a retained installation result', () => {
    const onInstall = vi.fn()
    render(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          isDetected={false}
          onInstall={onInstall}
          installation={{
            action: 'install',
            installing: false,
            result: { status: 'installed', version: '1.2.3' }
          }}
        />
      </TooltipProvider>
    )
    const button = screen.getByRole('button', { name: 'Install Codex' })
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    expect(onInstall).toHaveBeenCalledOnce()
  })

  it('offers a specific upgrade guide and the independent default action', () => {
    const card = renderCard()
    const guide = Array.from(card.querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Upgrade guide')
    )
    expect(guide).toBeDefined()
    expect(guide?.getAttribute('href')).not.toBe(props.homepageUrl)
    expect(card.textContent).toContain('Set as default')
  })

  it('retains version maintenance for disabled agents without offering default selection', () => {
    const card = renderCard({ isEnabled: false })
    expect(card.textContent).toContain('1.2.3')
    expect(card.textContent).toContain('1.2.4')
    expect(card.textContent).toContain('Upgrade guide')
    expect(card.textContent).not.toContain('Set as default')
  })

  it('upgrades with separate loading, unsupported recovery, retry and verified version change', () => {
    const onUpgrade = vi.fn()
    const { rerender } = render(
      <TooltipProvider>
        <AgentCatalogRow {...props} onUpgrade={onUpgrade} />
      </TooltipProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade Codex' }))
    expect(onUpgrade).not.toHaveBeenCalled()
    expect(screen.getByTestId('installation-review')).toBeTruthy()
    rerender(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          onUpgrade={onUpgrade}
          installation={{ action: 'upgrade', installing: true, result: null }}
        />
      </TooltipProvider>
    )
    expect(screen.getByRole('button', { name: 'Upgrade Codex' }).hasAttribute('disabled')).toBe(
      true
    )
    expect(screen.getByRole('button', { name: 'Upgrade Codex' }).textContent).toContain(
      'Upgrading…'
    )
    rerender(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          onUpgrade={onUpgrade}
          installation={{
            action: 'upgrade',
            installing: false,
            result: {
              status: 'unsupported',
              version: null,
              reason: 'upgrade-installation-unverified',
              output: 'native CLI'
            }
          }}
        />
      </TooltipProvider>
    )
    expect(screen.getByRole('alert').textContent).toContain('Use the upgrade guide')
    expect(screen.getByRole('link', { name: 'Upgrade guide' })).toBeTruthy()
    expect(screen.getByText('Upgrade output')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Upgrade Codex' }).textContent).toContain(
      'Retry upgrade'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade Codex' }))
    expect(onUpgrade).not.toHaveBeenCalled()
    expect(screen.getByTestId('installation-review')).toBeTruthy()
    rerender(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          onUpgrade={onUpgrade}
          installation={{
            action: 'upgrade',
            installing: false,
            result: { status: 'installed', version: '1.2.4', previousVersion: '1.2.3' }
          }}
        />
      </TooltipProvider>
    )
    expect(screen.getByRole('status').textContent).toContain('Upgraded')
    expect(screen.getByRole('status').textContent).toContain('1.2.3 →1.2.4')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    { ...props.versionSnapshot!, latestLoading: true },
    { ...props.versionSnapshot!, currentLoading: true },
    {
      ...props.versionSnapshot!,
      latest: { ...props.versionSnapshot!.latest!, status: 'error' as const }
    },
    { ...props.versionSnapshot!, current: { status: 'error' as const, version: '1.2.3' } },
    { ...props.versionSnapshot!, latest: { ...props.versionSnapshot!.latest!, version: '1.2.3' } },
    { ...props.versionSnapshot!, latest: { ...props.versionSnapshot!.latest!, version: '1.1.0' } },
    {
      ...props.versionSnapshot!,
      latest: { ...props.versionSnapshot!.latest!, version: '1.3.0-beta.1' }
    }
  ])(
    'requires verified update evidence before offering an automatic upgrade',
    (versionSnapshot) => {
      render(
        <TooltipProvider>
          <AgentCatalogRow {...props} onUpgrade={vi.fn()} versionSnapshot={versionSnapshot} />
        </TooltipProvider>
      )
      expect(screen.queryByRole('button', { name: 'Upgrade Codex' })).toBeNull()
    }
  )

  it('retains an active self-upgrade when the upstream explicitly has no version metadata', () => {
    render(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          onUpgrade={vi.fn()}
          versionSnapshot={{
            ...props.versionSnapshot!,
            latest: { status: 'unsupported', version: null, channel: 'npm-latest' }
          }}
        />
      </TooltipProvider>
    )
    expect(screen.getByRole('button', { name: 'Upgrade Codex' }).hasAttribute('disabled')).toBe(
      false
    )
  })

  it('can install the official CLI without claiming to repair a custom command', () => {
    render(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          isDetected={false}
          onInstall={vi.fn()}
          cmdOverride="/custom/codex"
        />
      </TooltipProvider>
    )
    expect(screen.getByRole('button', { name: 'Install Codex' }).textContent).toContain(
      'Install official CLI'
    )
    expect(
      screen.getByText(
        'Installs the official CLI. Your custom launch command must be updated separately.'
      )
    ).toBeTruthy()
  })

  it.each([
    ['install-timeout', 'Upgrade timed out. Check the network connection and retry.'],
    [
      'install-verification-failed',
      'Upgrade finished, but the agent version could not be verified. Check the output and refresh detection.'
    ],
    [
      'upgrade-target-unverifiable',
      'This CLI installation could not be verified for automatic upgrade. Use the upgrade guide.'
    ]
  ])('describes %s as an upgrade failure with the matching recovery', (reason, copy) => {
    render(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          onUpgrade={vi.fn()}
          installation={{
            action: 'upgrade',
            installing: false,
            result: { status: 'error', version: null, reason }
          }}
        />
      </TooltipProvider>
    )
    expect(screen.getByRole('alert').textContent).toBe(copy)
    expect(screen.getByRole('button', { name: 'Upgrade Codex' }).textContent).toContain(
      'Retry upgrade'
    )
  })

  it('exposes installation and loading feedback while retaining the guide', () => {
    const onInstall = vi.fn()
    const { rerender } = render(
      <TooltipProvider>
        <AgentCatalogRow {...props} isDetected={false} onInstall={onInstall} />
      </TooltipProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Install Codex' }))
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'Installation guide' })).toBeTruthy()
    rerender(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          isDetected={false}
          onInstall={onInstall}
          installation={{ installing: true, result: null }}
        />
      </TooltipProvider>
    )
    const installButton = screen.getByRole('button', { name: 'Install Codex' })
    expect(installButton.hasAttribute('disabled')).toBe(true)
    expect(installButton.getAttribute('aria-busy')).toBe('true')
    expect(installButton.textContent).toContain('Installing…')
  })

  it('shows actionable failure details, bounded output and retry', () => {
    const onInstall = vi.fn()
    const output = `discarded prefix${'x'.repeat(4096)}npm ERR! EACCES`
    render(
      <TooltipProvider>
        <AgentCatalogRow
          {...props}
          isDetected={false}
          onInstall={onInstall}
          installation={{
            installing: false,
            result: { status: 'error', version: null, reason: 'node-npm-unavailable', output }
          }}
        />
      </TooltipProvider>
    )
    expect(screen.getByRole('alert').textContent).toContain(
      'Install Node.js and npm in this environment'
    )
    expect(screen.getByText('Installation output')).toBeTruthy()
    const preview = document.querySelector('pre')!
    expect(preview.textContent).toHaveLength(4096)
    expect(preview.textContent).not.toContain('discarded prefix')
    expect(preview.textContent).toContain('npm ERR! EACCES')
    const retry = screen.getByRole('button', { name: 'Install Codex' })
    expect(retry.textContent).toContain('Retry')
    fireEvent.click(retry)
    expect(onInstall).toHaveBeenCalledOnce()
  })

  it('keeps unsupported installation as a guide and identifies a stale version bridge', () => {
    const unsupported = renderCard({ isDetected: false })
    expect(unsupported.textContent).toContain('Installation guide')
    expect(unsupported.querySelector('button')?.textContent).not.toBe('Install')
    const unavailable = renderCard({
      versionSnapshot: {
        current: { status: 'error', version: null, reason: 'bridge-unavailable' },
        latest: {
          status: 'error',
          version: null,
          channel: 'npm-latest',
          reason: 'bridge-unavailable'
        },
        currentLoading: false,
        latestLoading: false
      }
    })
    expect(unavailable.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(unavailable.textContent).toContain('Restart HiveCode')
  })
})
