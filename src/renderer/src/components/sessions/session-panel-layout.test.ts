import { expect, it } from 'vitest'
import {
  closeSessionPanelTab,
  EMPTY_SESSION_PANELS,
  openSessionPanelTab,
  resizeSessionPanel
} from './session-panel-layout'

const first = () => openSessionPanelTab(EMPTY_SESSION_PANELS, 'host-a|one', { newGroupId: 'a' })
it('clicks replace the active session without accumulating tabs', () => {
  const next = openSessionPanelTab(first(), 'host-b|two', { newGroupId: 'unused' })
  expect(next.groups).toEqual([{ id: 'a', keys: ['host-b|two'], activeKey: 'host-b|two' }])
})
it('center drops add a tab; edge drops reuse the split tree and closing collapses it', () => {
  const added = openSessionPanelTab(first(), 'host-b|two', {
    groupId: 'a',
    append: true,
    newGroupId: 'unused'
  })
  expect(added.groups[0].keys).toEqual(['host-a|one', 'host-b|two'])
  const split = openSessionPanelTab(added, 'host-b|two', {
    groupId: 'a',
    zone: 'right',
    append: true,
    newGroupId: 'b'
  })
  expect(split.layout).toMatchObject({
    type: 'split',
    direction: 'horizontal',
    first: { groupId: 'a' },
    second: { groupId: 'b' }
  })
  expect(split.groups.flatMap((group) => group.keys)).toEqual(['host-a|one', 'host-b|two'])
  expect(resizeSessionPanel(split, '', 0.7).layout).toMatchObject({ ratio: 0.7 })
  const closed = closeSessionPanelTab(split, 'host-b|two')
  expect(closed.layout).toEqual({ type: 'leaf', groupId: 'a' })
  expect(closeSessionPanelTab(closed, 'host-a|one')).toEqual(EMPTY_SESSION_PANELS)
})
it('focuses an already open session without duplicating its owner', () => {
  const split = openSessionPanelTab(first(), 'host-b|two', {
    groupId: 'a',
    zone: 'down',
    append: true,
    newGroupId: 'b'
  })
  const focused = openSessionPanelTab(split, 'host-a|one', { newGroupId: 'unused' })
  expect(focused.focusedGroupId).toBe('a')
  expect(focused.groups).toHaveLength(2)
  expect(
    openSessionPanelTab(focused, 'host-a|one', {
      groupId: 'a',
      zone: 'left',
      append: true,
      newGroupId: 'unused'
    })
  ).toBe(focused)
})
it('ignores stale drop targets instead of replacing unrelated panels', () => {
  const state = first()
  expect(
    openSessionPanelTab(state, 'host-b|two', {
      groupId: 'gone',
      append: true,
      newGroupId: 'unused'
    })
  ).toBe(state)
})
