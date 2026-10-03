// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ComputerUsePermissionState,
  ComputerUsePermissionStatusResult
} from '../../../../shared/computer-use-permissions-types'
import { ComputerUsePane, ComputerUsePermissionsSection } from './ComputerUsePane'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./ComputerUseSkillSetupPanel', () => ({
  ComputerUseSkillSetupPanel: () => <div>Skill setup</div>
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ recordFeatureInteraction: vi.fn() }) }
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn() } }))
vi.mock('../ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>
}))

const granted = [
  { id: 'accessibility' as const, status: 'granted' as const },
  { id: 'screenshots' as const, status: 'granted' as const }
]
const missing = [
  { id: 'accessibility' as const, status: 'not-granted' as const },
  { id: 'screenshots' as const, status: 'not-granted' as const }
]
const result = (
  platform: NodeJS.Platform,
  permissions: ComputerUsePermissionState[] = missing,
  helperUnavailableReason: string | null = null
): ComputerUsePermissionStatusResult => ({
  platform,
  permissions,
  helperUnavailableReason,
  helperAppPath: helperUnavailableReason ? null : '/Applications/HiveCode Helper.app'
})

describe('ComputerUsePermissionsSection', () => {
  let container: HTMLDivElement
  let root: Root
  let getStatus: ReturnType<typeof vi.fn>
  let openSetup: ReturnType<typeof vi.fn>
  let reset: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    getStatus = vi.fn()
    openSetup = vi.fn()
    reset = vi.fn()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { computerUsePermissions: { getStatus, openSetup, reset } }
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  const render = async (element: React.ReactNode): Promise<void> => {
    await act(async () => root.render(element))
  }

  const click = async (label: string, scope: ParentNode = container): Promise<void> => {
    const button = [...scope.querySelectorAll('button')].find((node) =>
      node.textContent?.includes(label)
    )
    expect(button, `button ${label}`).toBeTruthy()
    await act(async () => button?.click())
  }

  it('does not imply macOS while platform is unknown and hides OS permissions on Windows', async () => {
    let resolveStatus!: (value: ComputerUsePermissionStatusResult) => void
    getStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve
        })
    )

    await render(<ComputerUsePane />)
    expect(container.textContent).toContain('Checking local system permissions')
    expect(container.textContent).not.toContain('macOS')
    expect(container.textContent).not.toContain('Accessibility')
    expect(container.textContent).toContain('Skill setup')

    await act(async () => resolveStatus(result('win32')))
    expect(container.textContent).toBe('Skill setup')
  })

  it('shows a first-read error with retry, then blocks setup actions when the helper is unavailable', async () => {
    getStatus
      .mockRejectedValueOnce(new Error('Permission service offline'))
      .mockResolvedValueOnce(result('darwin', missing, 'Helper not installed'))

    await render(<ComputerUsePermissionsSection />)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Permission service offline'
    )
    expect(container.textContent).not.toContain('Accessibility')

    await click('Retry')
    expect(container.textContent).toContain('Accessibility')
    expect(container.textContent).toContain('Screen Recording (for screenshots)')
    expect(container.textContent).toContain('Helper not installed')
    expect(
      [...container.querySelectorAll('button')]
        .filter((node) => node.textContent?.includes('Open'))
        .every((node) => node.disabled)
    ).toBe(true)
    expect(
      [...container.querySelectorAll('button')].find((node) =>
        node.textContent?.includes('Reset access')
      )?.disabled
    ).toBe(true)
  })

  it('collapses granted details, refreshes on focus, and confirms before resetting access', async () => {
    getStatus
      .mockResolvedValueOnce(result('darwin', granted))
      .mockResolvedValueOnce(result('darwin', granted))
    reset.mockResolvedValue(result('darwin', missing))

    await render(<ComputerUsePermissionsSection />)
    expect(container.textContent).toContain('Computer Use is ready')
    expect(container.textContent).not.toContain('Accessibility')
    await click('View details')
    expect(container.textContent).toContain('Accessibility')

    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(getStatus).toHaveBeenCalledTimes(2)

    await click('Reset access')
    expect(reset).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'need to grant access again'
    )
    await click('Reset access', container.querySelector('[role="dialog"]')!)
    expect(reset).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Not enabled')
  })

  it('does not show stale ready status after a refresh error', async () => {
    getStatus
      .mockResolvedValueOnce(result('darwin', granted))
      .mockRejectedValueOnce(new Error('Status check failed'))

    await render(<ComputerUsePermissionsSection />)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Status check failed')
    expect(container.textContent).not.toContain('Computer Use is ready')
    await click('View details')
    expect(
      [...container.querySelectorAll('button')]
        .filter((node) => node.textContent?.includes('Open'))
        .every((node) => node.disabled)
    ).toBe(true)
  })

  it('shows a neutral retry after a later status error on Windows', async () => {
    getStatus
      .mockResolvedValueOnce(result('win32'))
      .mockRejectedValueOnce(new Error('Status check failed'))

    await render(<ComputerUsePermissionsSection />)
    expect(container.textContent).toBe('')
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Status check failed')
    expect(container.textContent).not.toContain('macOS')
    expect(container.textContent).not.toContain('Accessibility')
  })

  it('does not start a status probe while reset is in flight', async () => {
    getStatus.mockResolvedValue(result('darwin', missing))
    let resolveReset!: (value: ComputerUsePermissionStatusResult) => void
    reset.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReset = resolve
        })
    )

    await render(<ComputerUsePermissionsSection />)
    await click('Reset access')
    await click('Reset access', container.querySelector('[role="dialog"]')!)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(getStatus).toHaveBeenCalledTimes(1)
    await act(async () => resolveReset(result('darwin', granted)))
    expect(container.textContent).toContain('Computer Use is ready')
  })

  it('opens only one macOS permission setup at a time', async () => {
    getStatus.mockResolvedValue(result('darwin', missing))
    let resolveSetup!: (value: { platform: NodeJS.Platform; launchedHelper: boolean }) => void
    openSetup.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSetup = resolve
        })
    )

    await render(<ComputerUsePermissionsSection />)
    const openButtons = [...container.querySelectorAll('button')].filter((node) =>
      node.textContent?.includes('Open')
    )
    expect(openButtons).toHaveLength(2)
    await act(async () => {
      openButtons[0].click()
      openButtons[1].click()
    })
    expect(openSetup).toHaveBeenCalledTimes(1)
    expect(openButtons.every((button) => button.disabled)).toBe(true)

    await act(async () => resolveSetup({ platform: 'darwin', launchedHelper: true }))
    expect(openButtons.every((button) => button.disabled)).toBe(false)
  })
})
