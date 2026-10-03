// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { WorkEnvironmentsPane } from './WorkEnvironmentsPane'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))
vi.mock('./EphemeralVmsPane', () => ({ EphemeralVmsPane: () => <div>Cloud recipe controls</div> }))
vi.mock('./EphemeralVmRuntimesSection', () => ({
  EphemeralVmRuntimesSection: ({ active }: { active: boolean }) => (
    <div>Cloud lifecycle active: {String(active)}</div>
  )
}))
afterEach(cleanup)

describe('Work environments', () => {
  it('keeps lifecycle cleanup available when creation is disabled', () => {
    render(
      <WorkEnvironmentsPane settings={getDefaultSettings('/tmp')} updateSettings={vi.fn()} active />
    )
    expect(screen.getByRole('switch', { name: 'Toggle Cloud VM' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.queryByText('Cloud recipe controls')).not.toBeInTheDocument()
    expect(screen.getByText('Cloud lifecycle active: true')).toBeInTheDocument()
  })
  it('enables creation with the established preference', async () => {
    const updateSettings = vi.fn()
    render(
      <WorkEnvironmentsPane
        settings={getDefaultSettings('/tmp')}
        updateSettings={updateSettings}
        active
      />
    )
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Toggle Cloud VM' }))
    expect(updateSettings).toHaveBeenCalledWith({ experimentalEphemeralVms: true })
  })
  it('shows recipes when enabled and pauses lifecycle polling when inactive', () => {
    render(
      <WorkEnvironmentsPane
        settings={{ ...getDefaultSettings('/tmp'), experimentalEphemeralVms: true }}
        updateSettings={vi.fn()}
        active={false}
      />
    )
    expect(screen.getByText('Cloud recipe controls')).toBeInTheDocument()
    expect(screen.getByText('Cloud lifecycle active: false')).toBeInTheDocument()
  })
})
