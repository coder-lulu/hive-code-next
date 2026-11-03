// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginHostListEntry } from '../../../../../preload/api-types'
import { pluginListEntryFromInstalled } from '../list/plugin-list-entries'
import { PluginDetailPage } from './PluginDetailPage'

const plugin: PluginHostListEntry = {
  pluginKey: 'acme.worker',
  consentFingerprint: 'sha256-acme-worker',
  name: 'Acme Worker',
  version: '1.2.3',
  publisher: 'acme',
  status: 'pending',
  needsReconsent: false,
  isDev: false,
  official: false,
  bundled: false,
  execution: 'trusted-worker',
  capabilities: [{ kind: 'worker', description: 'Run a background worker process' }],
  panels: [],
  commands: [],
  hasWorker: true,
  restarts: 0,
  source: {
    kind: 'git',
    reference: 'https://gitlab.example/acme/worker#v1.2.3',
    resolvedCommit: '0123456789abcdef',
    contentHash: 'sha256'
  }
}

type Decide = (
  key: string,
  fingerprint: string,
  decision: 'approve' | 'keep-disabled'
) => Promise<void>
let root: Root | null = null
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      plugins: {
        getRollbackVersion: vi.fn().mockResolvedValue(null),
        getInstalledManifest: vi.fn().mockResolvedValue(null)
      },
      shell: { openUrl: vi.fn() }
    }
  })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function renderConsent(entry: PluginHostListEntry, onDecision: Decide): Promise<void> {
  await act(async () =>
    root?.render(
      <PluginDetailPage
        entry={pluginListEntryFromInstalled(entry)}
        busy={false}
        orcaVersion="1.4.214"
        logsState={undefined}
        handlers={{
          onOpen: vi.fn(),
          onReview: vi.fn(),
          onToggleEnabled: vi.fn(),
          onRestart: vi.fn(),
          onViewLogs: vi.fn(),
          onCheckUpdate: vi.fn(),
          onRollbackRequest: vi.fn(),
          onRemoveRequest: vi.fn()
        }}
        fetchPreview={vi.fn().mockResolvedValue({ ok: false })}
        install={{ phaseOf: () => null, install: vi.fn(), dismiss: vi.fn() }}
        refreshing={false}
        onConsent={onDecision}
        onBack={vi.fn()}
        onOpenShortcuts={vi.fn()}
      />
    )
  )
}
async function click(label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!button) throw new Error(`Missing consent action: ${label}`)
  await act(async () => button.click())
}

describe('PluginDetailPage consent authority', () => {
  it('keeps displayed permissions and fingerprint immutable during a same-key update', async () => {
    const decide = vi.fn().mockResolvedValue(undefined)
    await renderConsent(plugin, decide)
    await renderConsent(
      {
        ...plugin,
        consentFingerprint: 'sha256-unreviewed-update',
        capabilities: [{ kind: 'secrets:read', description: 'Read a newly added secret' }]
      },
      decide
    )
    expect(container.textContent).not.toContain('Read a newly added secret')
    await click('Enable plugin')
    expect(decide).toHaveBeenCalledWith(plugin.pluginKey, plugin.consentFingerprint, 'approve')
  })
  it('shows provenance and worker access on host-owned chrome without focusing approval', async () => {
    const decide = vi.fn().mockResolvedValue(undefined)
    await renderConsent(plugin, decide)
    expect(container.textContent).toContain(plugin.publisher)
    expect(container.textContent).toContain('Source')
    expect(container.textContent).toContain('Run a background worker process')
    expect(container.textContent).toContain(
      'can read your files, use the network and run other programs'
    )
    expect(container.querySelector('[data-plugin-consent]')?.classList).toContain(
      'plugin-security-chrome'
    )
    expect(document.activeElement?.textContent).toBe(plugin.name)
    expect(decide).not.toHaveBeenCalled()
  })
  it('warns about panel code without granting it worker permissions', async () => {
    await renderConsent(
      {
        ...plugin,
        execution: 'sandboxed-ui',
        hasWorker: false,
        capabilities: [{ kind: 'panels', description: 'Add an Acme panel' }]
      },
      vi.fn()
    )
    expect(container.textContent).toContain('publisher')
    expect(container.textContent).toContain('draw its view')
    expect(container.textContent).not.toContain('can read your files, use the network')
  })
  it('describes inert content without inventing requested permissions', async () => {
    await renderConsent(
      { ...plugin, execution: 'data', hasWorker: false, capabilities: [] },
      vi.fn()
    )
    expect(container.textContent).toContain('Content only. No code runs.')
    expect(container.textContent).toContain('No other access')
    expect(container.textContent).not.toContain('Full access:')
  })
  it('shows every VM recipe lifecycle command verbatim', async () => {
    await renderConsent(
      {
        ...plugin,
        execution: 'declarative',
        hasWorker: false,
        capabilities: [],
        vmRecipes: [
          {
            id: 'cloud',
            name: 'Cloud Sandbox',
            description: 'Creates a disposable VM.',
            commands: [
              { phase: 'create', command: './scripts/create.sh --exact "$VALUE"' },
              { phase: 'suspend', command: './scripts/suspend.sh' },
              { phase: 'resume', command: './scripts/resume.sh' },
              { phase: 'destroy', command: 'none' }
            ]
          }
        ]
      },
      vi.fn()
    )
    expect(container.textContent).toContain('Its commands can act for you or your agents')
    const commands = Array.from(container.querySelectorAll('pre'))
    expect(commands.map((command) => command.textContent)).toEqual([
      './scripts/create.sh --exact "$VALUE"',
      './scripts/suspend.sh',
      './scripts/resume.sh',
      'none'
    ])
    expect(commands[0]?.tabIndex).toBe(0)
    expect(commands[0]?.getAttribute('aria-label')).toBe('Cloud Sandbox · Create command')
  })
  it('names the built-in shortcut a plugin replaces before consent', async () => {
    await renderConsent(
      {
        ...plugin,
        execution: 'declarative',
        hasWorker: false,
        capabilities: [],
        commands: [
          {
            id: 'tasks',
            title: 'Open Tasks',
            context: 'global',
            handler: { type: 'built-in', action: 'view.tasks' },
            keybindings: [{ key: 'Mod+P', when: 'global' }]
          }
        ]
      },
      vi.fn()
    )
    expect(container.textContent).toContain('Open Tasks')
    expect(container.textContent).toContain('replaces your shortcut for Go to File')
  })
  it('records an explicit Keep off decision and never approves on Escape', async () => {
    const decide = vi.fn().mockResolvedValue(undefined)
    await renderConsent(plugin, decide)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(decide).not.toHaveBeenCalled()
    await click('Keep off')
    expect(decide).toHaveBeenCalledWith(
      plugin.pluginKey,
      plugin.consentFingerprint,
      'keep-disabled'
    )
  })
  it('labels re-consent and grants it only on explicit approval', async () => {
    const decide = vi.fn().mockResolvedValue(undefined)
    await renderConsent({ ...plugin, needsReconsent: true }, decide)
    expect(container.textContent).toContain('Changed since you approved it')
    expect(decide).not.toHaveBeenCalled()
    await click('Enable plugin')
    expect(decide).toHaveBeenCalledWith(plugin.pluginKey, plugin.consentFingerprint, 'approve')
  })
  it('keeps stale approval rejected and tells the user to review again', async () => {
    const decide = vi.fn().mockRejectedValue(new Error('reviewed fingerprint is no longer current'))
    await renderConsent(plugin, decide)
    await click('Enable plugin')
    expect(container.textContent).toContain(
      'This plugin changed while you were reviewing it. Review it again.'
    )
    expect(decide).toHaveBeenCalledWith(plugin.pluginKey, plugin.consentFingerprint, 'approve')
  })
})
