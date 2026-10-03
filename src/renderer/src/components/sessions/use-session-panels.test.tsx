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

function collectionSetup(inventory = items, selectedKey: string | null = null) {
  return renderHook(
    ({ inventory, collectionKey }) => {
      const [selected, select] = useState<string | null>(selectedKey)
      return { ...useSessionPanels(inventory, selected, select, collectionKey), selected }
    },
    { initialProps: { inventory, collectionKey: 'local|workspace' } }
  )
}

it('opens all workspace sessions in one group and honors a valid requested selection', () => {
  const view = collectionSetup(items, 'b')
  expect(view.result.current.panels.groups).toHaveLength(1)
  expect(view.result.current.panels.groups[0]).toMatchObject({ keys: ['a', 'b'], activeKey: 'b' })
  expect(view.result.current.selected).toBe('b')
})

it('defaults to the first session and resets closed tabs and splits on workspace changes', () => {
  const view = collectionSetup()
  expect(view.result.current.selected).toBe('a')
  act(() => view.result.current.close('b'))
  view.rerender({ inventory: items, collectionKey: 'local|workspace' })
  expect(view.result.current.panels.groups[0].keys).toEqual(['a'])
  view.rerender({ inventory: [{ key: 'c' }] as SessionListItem[], collectionKey: 'local|other' })
  expect(view.result.current.selected).toBe('c')
  expect(view.result.current.panels.groups[0].keys).toEqual(['c'])
  view.rerender({ inventory: items, collectionKey: 'local|workspace' })
  expect(view.result.current.panels.groups[0].keys).toEqual(['a', 'b'])
  expect(view.result.current.selected).toBe('a')
})

it('appends asynchronously discovered sessions while preserving split geometry and current selection', () => {
  const view = collectionSetup()
  act(() => view.result.current.open('b', view.result.current.panels.groups[0].id, 'right'))
  act(() => view.result.current.resize('', 0.7))
  const layout = view.result.current.panels.layout
  view.rerender({
    inventory: [...items, { key: 'c' } as SessionListItem],
    collectionKey: 'local|workspace'
  })
  expect(view.result.current.panels.layout).toBe(layout)
  expect(view.result.current.panels.groups.map((group) => group.keys)).toEqual([['a'], ['b', 'c']])
  expect(view.result.current.selected).toBe('b')
  act(() => view.result.current.close('c'))
  view.rerender({
    inventory: [...items, { key: 'c' } as SessionListItem],
    collectionKey: 'local|workspace'
  })
  expect(view.result.current.panels.groups.map((group) => group.keys)).toEqual([['a'], ['b']])
  view.rerender({ inventory: [items[0]], collectionKey: 'local|workspace' })
  expect(view.result.current.panels.groups).toHaveLength(1)
  expect(view.result.current.selected).toBe('a')
})

it('fills an initially empty workspace and keeps deliberately closed tabs closed after all are closed', () => {
  const view = collectionSetup([])
  expect(view.result.current.panels.groups).toEqual([])
  view.rerender({ inventory: items, collectionKey: 'local|workspace' })
  expect(view.result.current.selected).toBe('a')
  act(() => view.result.current.close('a'))
  act(() => view.result.current.close('b'))
  view.rerender({ inventory: [...items], collectionKey: 'local|workspace' })
  expect(view.result.current.panels.groups).toEqual([])
  expect(view.result.current.selected).toBeNull()
  act(() => view.result.current.open('a'))
  expect(view.result.current.panels.groups[0].keys).toEqual(['a'])
  act(() => view.result.current.reopenAll())
  expect(view.result.current.panels.groups[0].keys).toEqual(['a', 'b'])
})
