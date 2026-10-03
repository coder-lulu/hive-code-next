// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { AiServicesPane } from './AiServicesPane'

vi.mock('../stats/StatsPane', () => ({
  StatsPane: ({ isActive }: { isActive: boolean }) => (
    <div>
      <input aria-label="Usage filter" defaultValue="30d" />
      <span>{String(isActive)}</span>
    </div>
  )
}))
vi.mock('./AccountsPane', () => ({ AccountsPane: () => <input aria-label="Provider draft" /> }))
afterEach(cleanup)

it('opens usage when the settings scroll target is the accounts section itself', () => {
  render(
    <AiServicesPane
      settings={getDefaultSettings('/tmp')}
      updateSettings={vi.fn()}
      navigationTargetSectionId="accounts"
    />
  )
  expect(screen.getByRole('tab', { name: 'Usage' }).getAttribute('aria-selected')).toBe('true')
})

it('defaults to usage and retains filters and provider drafts across tabs', () => {
  render(<AiServicesPane settings={getDefaultSettings('/tmp')} updateSettings={vi.fn()} />)
  expect(screen.getByRole('tab', { name: 'Usage' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.change(screen.getByLabelText('Usage filter'), { target: { value: '7d' } })
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'AI Providers' }), {
    button: 0,
    ctrlKey: false
  })
  fireEvent.change(screen.getByLabelText('Provider draft'), { target: { value: 'unsaved' } })
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Usage' }), { button: 0, ctrlKey: false })
  expect((screen.getByLabelText('Usage filter') as HTMLInputElement).value).toBe('7d')
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'AI Providers' }), {
    button: 0,
    ctrlKey: false
  })
  expect((screen.getByLabelText('Provider draft') as HTMLInputElement).value).toBe('unsaved')
})

it('routes account deep links to providers and usage links back to usage', () => {
  const props = { settings: getDefaultSettings('/tmp'), updateSettings: vi.fn() }
  const { rerender } = render(
    <AiServicesPane {...props} navigationTargetSectionId="accounts-codex" />
  )
  expect(screen.getByRole('tab', { name: 'AI Providers' }).getAttribute('aria-selected')).toBe(
    'true'
  )
  rerender(<AiServicesPane {...props} navigationTargetSectionId="usage" />)
  expect(screen.getByRole('tab', { name: 'Usage' }).getAttribute('aria-selected')).toBe('true')
})
