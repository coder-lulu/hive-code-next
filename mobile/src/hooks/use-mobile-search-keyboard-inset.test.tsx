import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMobileSearchKeyboardInset } from './use-mobile-search-keyboard-inset'

const keyboard = vi.hoisted(() => ({
  height: 0,
  show: (_height: number) => {},
  hide: () => {},
  removed: vi.fn()
}))

vi.mock('../platform/keyboard-occlusion', () => ({
  currentSoftKeyboardHeight: () => keyboard.height,
  subscribeSoftKeyboard: (show: (height: number) => void, hide: () => void) => {
    keyboard.show = show
    keyboard.hide = hide
    return keyboard.removed
  }
}))

let inset = 0
let tree: ReactTestRenderer | undefined
function Search({ enabled }: { enabled: boolean }) {
  inset = useMobileSearchKeyboardInset(enabled)
  return null
}
beforeEach(() => {
  keyboard.height = 240
  keyboard.removed.mockClear()
})
afterEach(() => act(() => tree?.unmount()))

it('seeds a late search from the platform, follows events, and clamps invalid heights', () => {
  act(() => {
    tree = create(createElement(Search, { enabled: true }))
  })
  expect(inset).toBe(240)
  act(() => keyboard.show(320))
  expect(inset).toBe(320)
  act(() => keyboard.hide())
  expect(inset).toBe(0)
  act(() => keyboard.show(-20))
  expect(inset).toBe(0)
})

it('releases the platform subscription while disabled and resamples when reopened', () => {
  act(() => {
    tree = create(createElement(Search, { enabled: true }))
  })
  act(() => tree?.update(createElement(Search, { enabled: false })))
  expect(inset).toBe(0)
  expect(keyboard.removed).toHaveBeenCalledTimes(1)
  keyboard.height = 120
  act(() => tree?.update(createElement(Search, { enabled: true })))
  expect(inset).toBe(120)
})
