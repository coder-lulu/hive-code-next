// @vitest-environment happy-dom
import { useState } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useSessionPanels } from './use-session-panels'
import type { SessionListItem } from './session-list-types'

afterEach(cleanup)
const items = [{ key: 'a' }, { key: 'b' }] as SessionListItem[]
function setup() {
  return renderHook(
    ({ inventory }) => {
      const [selected, select] = useState<string | null>('a')
      return { ...useSessionPanels(inventory, selected, select), selected }
    },
    { initialProps: { inventory: items } }
  )
}
it('keeps the remaining split visible when its selected sibling disappears', () => {
  const view = setup()
  act(() => view.result.current.open('b', view.result.current.panels.groups[0].id, 'right'))
  expect(view.result.current.panels.groups).toHaveLength(2)
  view.rerender({ inventory: [items[0]] })
  expect(view.result.current.selected).toBe('a')
  expect(view.result.current.panels.groups).toHaveLength(1)
})
it('closing or archiving a panel preserves the other session and does not resurrect it', () => {
  const view = setup()
  act(() => view.result.current.open('b', view.result.current.panels.groups[0].id, 'right'))
  act(() => view.result.current.close('b'))
  expect(view.result.current.selected).toBe('a')
  expect(view.result.current.panels.groups.flatMap((group) => group.keys)).toEqual(['a'])
  act(() => view.result.current.open('a'))
  expect(view.result.current.panels.groups).toHaveLength(1)
})
