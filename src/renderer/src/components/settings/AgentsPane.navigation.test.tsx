// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { useAppStore } from '@/store'
import { TooltipProvider } from '../ui/tooltip'
import { AgentsPane } from './AgentsPane'
import { AGENT_DEFAULT_ENV_DRAFT_MAX_BYTES } from './agent-default-env-draft'

vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({
    detectedIds: ['claude', 'codex'],
    isLoading: false,
    detectionFailed: false,
    isRefreshing: false,
    refresh: vi.fn()
  })
}))

function mountPane(settings = getDefaultSettings('/tmp')) {
  const updateSettings = vi.fn((updates: Partial<GlobalSettings>) => {
    useAppStore.setState((state) => ({ settings: { ...state.settings!, ...updates } }))
  })
  useAppStore.setState({
    settings,
    settingsSearchInputQuery: '',
    settingsSearchQuery: '',
    settingsNavigationTarget: null
  })
  function Pane() {
    const current = useAppStore((state) => state.settings!)
    return (
      <TooltipProvider>
        <AgentsPane settings={current} updateSettings={updateSettings} />
      </TooltipProvider>
    )
  }
  render(<Pane />)
  return updateSettings
}

describe('Agents settings navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  it('can repair an existing undetected command override without exposing other launch fields', () => {
    const updateSettings = mountPane({
      ...getDefaultSettings('/tmp'),
      agentCmdOverrides: { grok: '/missing/grok', claude: '/kept/claude' }
    })
    act(() =>
      useAppStore.setState({
        settingsNavigationTarget: { pane: 'agents', repoId: null, sectionId: 'agent-config-grok' }
      })
    )
    const command = screen.getByRole('textbox', { name: 'Command' }) as HTMLInputElement
    expect(command.value).toBe('/missing/grok')
    expect(screen.queryByRole('textbox', { name: 'Arguments' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Environment' })).toBeNull()
    command.focus()
    fireEvent.change(command, { target: { value: '/valid/grok' } })
    fireEvent.keyDown(command, { key: 'Enter' })
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      agentCmdOverrides: { grok: '/valid/grok', claude: '/kept/claude' }
    })
    expect(useAppStore.getState().settings?.agentCmdOverrides?.grok).toBe('/valid/grok')
    const saved = screen.getByRole('textbox', { name: 'Command' }) as HTMLInputElement
    saved.focus()
    fireEvent.change(saved, { target: { value: '/discarded/grok' } })
    fireEvent.keyDown(saved, { key: 'Escape' })
    expect(saved.value).toBe('/valid/grok')
    expect(updateSettings).toHaveBeenCalledOnce()
    expect(document.querySelector('#agent-card-grok')?.getAttribute('data-installed')).toBe('false')
  })

  it('can restore an undetected override to the default while preserving the no-override policy', () => {
    const updateSettings = mountPane({
      ...getDefaultSettings('/tmp'),
      agentCmdOverrides: { grok: '/missing/grok', claude: '/kept/claude' }
    })
    act(() =>
      useAppStore.setState({
        settingsNavigationTarget: { pane: 'agents', repoId: null, sectionId: 'agent-config-grok' }
      })
    )
    const command = screen.getByRole('textbox', { name: 'Command' })
    fireEvent.change(command, { target: { value: 'grok' } })
    fireEvent.keyDown(command, { key: 'Enter' })
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      agentCmdOverrides: { claude: '/kept/claude' }
    })
    expect(useAppStore.getState().settings?.agentCmdOverrides?.grok).toBeUndefined()
    expect(screen.queryByRole('textbox', { name: 'Command' })).toBeNull()
    expect(
      within(document.querySelector<HTMLElement>('#agent-config-grok')!).getByText(
        'This agent has not been detected in the current environment. Install it and refresh detection to configure its launch.'
      )
    ).toBeTruthy()
  })

  it('preserves detected-agent command and arguments editing', () => {
    const initialSettings = getDefaultSettings('/tmp')
    const updateSettings = mountPane(initialSettings)
    fireEvent.click(screen.getByRole('button', { name: 'Launch configuration for Claude' }))
    const command = screen.getByRole('textbox', { name: 'Command' })
    fireEvent.change(command, { target: { value: '/valid/claude' } })
    fireEvent.blur(command)
    expect(updateSettings).toHaveBeenCalledWith({ agentCmdOverrides: { claude: '/valid/claude' } })
    const args = screen.getByRole('textbox', { name: 'Arguments' })
    fireEvent.change(args, { target: { value: '--debug' } })
    fireEvent.blur(args)
    expect(updateSettings).toHaveBeenCalledWith({
      agentDefaultArgs: { ...initialSettings.agentDefaultArgs, claude: '--debug' }
    })
    expect(screen.getByRole('textbox', { name: 'Command' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Arguments' })).toBeTruthy()
  })

  it('opens agent management when settings search targets the new package source', () => {
    mountPane()
    fireEvent.click(screen.getByRole('tab', { name: 'Run preferences' }))
    act(() => useAppStore.setState({ settingsSearchQuery: 'package source' }))
    expect(
      screen.getByRole('tab', { name: 'Agent management' }).getAttribute('aria-selected')
    ).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Package source' })).toBeTruthy()
  })

  it('persists the fixed package source and keeps expanded provider installs available with a custom command', async () => {
    const updateSettings = mountPane({
      ...getDefaultSettings('/tmp'),
      agentCmdOverrides: { grok: '/custom/grok' }
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Package source' }))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Default source', 'China mirror'])
    await user.click(screen.getByRole('option', { name: 'China mirror' }))
    expect(updateSettings).toHaveBeenCalledWith({ agentNpmRegistry: 'china' })
    expect(useAppStore.getState().settings?.agentNpmRegistry).toBe('china')
    const grok = screen.getByRole('article', { name: 'Grok' })
    expect(within(grok).getByRole('button', { name: 'Install Grok' }).textContent).toContain(
      'Install official CLI'
    )
    expect(
      within(grok).getByText(
        'Installs the official CLI. Your custom launch command must be updated separately.'
      )
    ).toBeTruthy()
    const mimo = screen.getByRole('article', { name: 'MiMo Code' })
    expect(within(mimo).queryByRole('button', { name: 'Install MiMo Code' })).toBeNull()
    expect(
      within(mimo).getByText(
        'Automatic installation is unavailable for this agent. Use the installation guide.'
      )
    ).toBeTruthy()
    expect(within(mimo).getByRole('link', { name: 'Installation guide' })).toBeTruthy()
  })

  it('keeps search focused while debounced matches open advanced configuration', async () => {
    mountPane()
    function SearchField() {
      const query = useAppStore((state) => state.settingsSearchInputQuery)
      const onChange = useAppStore((state) => state.setSettingsSearchQuery)
      return (
        <input
          aria-label="Search settings"
          value={query}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    }
    render(<SearchField />)
    const input = screen.getByRole('textbox', { name: 'Search settings' })
    input.focus()
    fireEvent.change(input, { target: { value: 'launch arguments' } })
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Advanced configuration' }).getAttribute('aria-selected')
      ).toBe('true')
    )
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: 'environment variables' } })
    await waitFor(() =>
      expect(useAppStore.getState().settingsSearchQuery).toBe('environment variables')
    )
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: '' } })
    expect(document.activeElement).toBe(input)
  })

  it('opens the matching preferences tab when settings search targets a moved setting', () => {
    mountPane()
    act(() => useAppStore.setState({ settingsSearchQuery: 'permission' }))
    expect(screen.getByRole('tab', { name: 'Run preferences' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(screen.getByRole('radiogroup', { name: 'Agent Permissions' })).toBeTruthy()
  })

  it('opens and focuses the matching agent configuration from its installed card', () => {
    mountPane()
    fireEvent.click(screen.getByRole('button', { name: 'Launch configuration for Codex' }))
    expect(
      screen.getByRole('tab', { name: 'Advanced configuration' }).getAttribute('aria-selected')
    ).toBe('true')
    expect(screen.getByRole('heading', { name: 'Codex launch configuration' })).toBe(
      document.activeElement
    )
    expect(screen.getByRole('textbox', { name: 'Command' }).getAttribute('placeholder')).toBe(
      'codex'
    )
  })

  it('opens the correct tab and agent for a configuration deep link', () => {
    mountPane()
    act(() =>
      useAppStore.setState({
        settingsNavigationTarget: { pane: 'agents', repoId: null, sectionId: 'agent-config-codex' }
      })
    )
    expect(
      screen.getByRole('tab', { name: 'Advanced configuration' }).getAttribute('aria-selected')
    ).toBe('true')
    expect(screen.getByRole('textbox', { name: 'Command' }).getAttribute('placeholder')).toBe(
      'codex'
    )
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Codex launch configuration' })
    )
  })

  it('keeps installed version maintenance visible when disabling the default agent', async () => {
    mountPane({ ...getDefaultSettings('/tmp'), defaultTuiAgent: 'claude' })
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Claude availability' }))
    })
    expect(screen.getByRole('combobox', { name: 'Default Agent' }).textContent).toContain('Auto')
    const card = screen.getByRole('article', { name: 'Claude' })
    expect(within(card).getByText('Current version')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Set as default' })).toBeNull()
    expect(within(card).getByText('Disabled')).toBeTruthy()
  })

  it('preserves a rejected environment draft and its error when leaving and returning to configuration', () => {
    mountPane({ ...getDefaultSettings('/tmp'), agentDefaultEnv: { claude: { ORIGINAL: 'kept' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Launch configuration for Claude' }))
    const input = screen.getByRole('textbox', { name: 'Environment' }) as HTMLInputElement
    const oversized = `VALUE=${'x'.repeat(AGENT_DEFAULT_ENV_DRAFT_MAX_BYTES)}`
    fireEvent.change(input, { target: { value: oversized } })
    fireEvent.blur(input)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agent management' }), { button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Launch configuration for Codex' }))
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agent management' }), { button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Launch configuration for Claude' }))
    const restored = screen.getByRole('textbox', { name: 'Environment' }) as HTMLInputElement
    expect(restored.value).toBe(oversized)
    expect(restored.getAttribute('aria-invalid')).toBe('true')
  })
})
