import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { useMobileUpdate } from './use-mobile-update'

const deps = vi.hoisted(() => ({
  check: vi.fn(),
  resume: vi.fn(),
  show: vi.fn(),
  remove: vi.fn(),
  listener: vi.fn(),
  snapshot: { state: 'idle' }
}))
vi.mock('react-native', () => ({ AppState: { addEventListener: deps.listener } }))
vi.mock('./mobile-update-service', () => ({
  checkMobileUpdate: deps.check,
  resumeMobileUpdate: deps.resume,
  showMobileUpdatePrompt: deps.show,
  dismissMobileUpdatePrompt: vi.fn(),
  downloadAndInstallAndroidUpdate: vi.fn(),
  getMobileUpdateSnapshot: () => deps.snapshot,
  subscribeMobileUpdate: () => () => {}
}))

it('checks freshly on launch, routes foreground through recovery, and removes the listener', async () => {
  deps.listener.mockReturnValue({ remove: deps.remove })
  function Observer() {
    useMobileUpdate(true)
    return null
  }
  let renderer!: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(Observer))
  })
  expect(deps.check).toHaveBeenCalledWith({ force: true })
  const onChange = deps.listener.mock.calls[0][1]
  onChange('background')
  expect(deps.resume).not.toHaveBeenCalled()
  onChange('active')
  expect(deps.resume).toHaveBeenCalledOnce()
  await act(async () => renderer.unmount())
  expect(deps.remove).toHaveBeenCalledOnce()
})
