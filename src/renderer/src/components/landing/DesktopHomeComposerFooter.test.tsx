// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_CATALOG } from '@/lib/agent-catalog'
import { i18n } from '@/i18n/i18n'
import { buildDesktopHomeModel } from './desktop-home-model'
import { DesktopHomeComposerFooter } from './DesktopHomeComposerFooter'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const EMPTY_HOME_MODEL = buildDesktopHomeModel({
  repos: [],
  worktreesByRepo: {},
  tabsByWorktree: {},
  openFiles: []
})

describe('DesktopHomeComposerFooter', () => {
  it('renders the composer controls entirely in English when English is active', async () => {
    await i18n.changeLanguage('en')

    const { container } = render(
      <DesktopHomeComposerFooter
        model={EMPTY_HOME_MODEL}
        selectedWorkspaceId=""
        onWorkspaceChange={vi.fn()}
        agent="codex"
        agents={AGENT_CATALOG.filter((entry) => entry.id === 'codex')}
        onAgentChange={vi.fn()}
        defaultAgent="codex"
        onSetDefaultAgent={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        permissionMode="default"
        onPermissionChange={vi.fn()}
        hasDraft={false}
        onSubmit={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Task type' }).textContent).toContain(
      'Code development'
    )
    expect(screen.getByRole('button', { name: 'Task mode' }).textContent).toContain('Task mode')
    expect(screen.getByRole('button', { name: 'Execution quality' }).textContent).toContain(
      'Balanced'
    )
    expect(screen.getByRole('button', { name: 'Permission mode' }).textContent).toContain('Default')
    expect(container.textContent).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('renders only detected agent entries with their catalog icons', () => {
    const agents = AGENT_CATALOG.filter(
      (entry) => entry.id === 'codex' || entry.id === 'openclaude'
    )

    render(
      <DesktopHomeComposerFooter
        model={EMPTY_HOME_MODEL}
        selectedWorkspaceId=""
        onWorkspaceChange={vi.fn()}
        agent="codex"
        agents={agents}
        onAgentChange={vi.fn()}
        defaultAgent="codex"
        onSetDefaultAgent={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        permissionMode="default"
        onPermissionChange={vi.fn()}
        hasDraft={false}
        onSubmit={vi.fn()}
      />
    )

    const trigger = screen.getByRole('combobox')
    expect(trigger.querySelector('img, svg')).not.toBeNull()
    fireEvent.click(trigger)

    const codexOption = screen.getByRole('option', { name: 'Codex' })
    const openClaudeOption = screen.getByRole('option', { name: 'OpenClaude' })
    expect(codexOption.querySelector('img, svg')).not.toBeNull()
    expect(openClaudeOption.querySelector('img, svg')).not.toBeNull()
    expect(screen.queryByRole('option', { name: 'Claude' })).toBeNull()
  })

  it('offers a workspace selection instead of a temporary session on Web', () => {
    render(
      <DesktopHomeComposerFooter
        allowTemporarySession={false}
        model={EMPTY_HOME_MODEL}
        selectedWorkspaceId=""
        onWorkspaceChange={vi.fn()}
        agent="hivecode"
        agents={AGENT_CATALOG.filter((entry) => entry.id === 'hivecode')}
        onAgentChange={vi.fn()}
        defaultAgent="hivecode"
        onSetDefaultAgent={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        permissionMode="default"
        onPermissionChange={vi.fn()}
        hasDraft={false}
        onSubmit={vi.fn()}
      />
    )
    const trigger = screen.getByRole('button', { name: /project or workspace/i })
    expect(trigger.textContent).toContain('Select Host workspace')
    expect(screen.getByRole('button', { name: 'Send task' }).hasAttribute('disabled')).toBe(true)
    fireEvent.pointerDown(trigger, new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(screen.queryByRole('menuitem', { name: /Temporary session/ })).toBeNull()
    expect(
      screen.getByRole('menuitem', { name: /Select Host workspace/ }).getAttribute('aria-disabled')
    ).toBe('true')
  })

  it('bounds the project selector while preserving full labels on hover', () => {
    render(
      <DesktopHomeComposerFooter
        model={EMPTY_HOME_MODEL}
        selectedWorkspaceId=""
        onWorkspaceChange={vi.fn()}
        agent="codex"
        agents={AGENT_CATALOG.filter((entry) => entry.id === 'codex')}
        onAgentChange={vi.fn()}
        defaultAgent="codex"
        onSetDefaultAgent={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        permissionMode="default"
        onPermissionChange={vi.fn()}
        hasDraft={false}
        onSubmit={vi.fn()}
      />
    )

    const trigger = screen.getByRole('button', { name: /project or workspace/i })
    expect(trigger.className).toContain('desktop-home-project-trigger')
    expect(trigger.querySelector('.truncate')?.getAttribute('title')).toBe('Temporary session')

    fireEvent.pointerDown(trigger, new PointerEvent('pointerdown', { bubbles: true, button: 0 }))

    const item = screen.getByRole('menuitem', { name: /Temporary session/ })
    const content = item.closest('[data-slot="dropdown-menu-content"]')
    expect(content?.className).toContain(
      'max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))]'
    )
    expect(content?.className).toContain('min-w-[min(280px,calc(100vw-1rem))]')
    expect(content?.className).toContain('max-w-[min(420px,calc(100vw-1rem))]')
    expect(item.querySelector('.truncate')?.getAttribute('title')).toBe('Temporary session')
  })

  it.each([
    ['Always ask', 'manual'],
    ['Auto-approve', 'yolo']
  ] as const)('maps %s to the real launch permission mode', (label, mode) => {
    const onPermissionChange = vi.fn()

    render(
      <DesktopHomeComposerFooter
        model={EMPTY_HOME_MODEL}
        selectedWorkspaceId=""
        onWorkspaceChange={vi.fn()}
        agent="codex"
        agents={AGENT_CATALOG.filter((entry) => entry.id === 'codex')}
        onAgentChange={vi.fn()}
        defaultAgent="codex"
        onSetDefaultAgent={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        permissionMode="default"
        onPermissionChange={onPermissionChange}
        hasDraft
        onSubmit={vi.fn()}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Permission mode' })
    fireEvent.pointerDown(trigger, new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    fireEvent.click(screen.getByRole('menuitem', { name: label }))

    expect(onPermissionChange).toHaveBeenCalledWith(mode)
  })

  it('disables permission overrides for an agent without a canonical mapping', () => {
    render(
      <DesktopHomeComposerFooter
        model={EMPTY_HOME_MODEL}
        selectedWorkspaceId=""
        onWorkspaceChange={vi.fn()}
        agent="opencode"
        agents={AGENT_CATALOG.filter((entry) => entry.id === 'opencode')}
        onAgentChange={vi.fn()}
        defaultAgent="opencode"
        onSetDefaultAgent={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        permissionMode="default"
        onPermissionChange={vi.fn()}
        hasDraft
        onSubmit={vi.fn()}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Permission mode' })
    fireEvent.pointerDown(trigger, new PointerEvent('pointerdown', { bubbles: true, button: 0 }))

    expect(screen.getByRole('menuitem', { name: /Always ask/ }).hasAttribute('data-disabled')).toBe(
      true
    )
    expect(
      screen.getByRole('menuitem', { name: /Auto-approve/ }).hasAttribute('data-disabled')
    ).toBe(true)
  })
})
