import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { buildSplitNode, replaceLeaf, updateSplitRatio } from '@/store/slices/tabs/tabs-layout'
import { pruneTabGroupLayout } from '@/runtime/web-session-tabs-sync/tab-group-layout-tree'
import type { TabDropZone } from '../tab-group/tab-drag-data'

export type SessionPanelGroup = { id: string; keys: string[]; activeKey: string }
export type SessionPanelLayout = {
  layout: TabGroupLayoutNode | null
  groups: SessionPanelGroup[]
  focusedGroupId: string | null
}
export const EMPTY_SESSION_PANELS: SessionPanelLayout = {
  layout: null,
  groups: [],
  focusedGroupId: null
}

export function closeSessionPanelTab(state: SessionPanelLayout, key: string): SessionPanelLayout {
  const groups = state.groups.flatMap((group) => {
    const keys = group.keys.filter((candidate) => candidate !== key)
    return keys.length
      ? [
          {
            ...group,
            keys,
            activeKey: keys.includes(group.activeKey) ? group.activeKey : keys.at(-1)!
          }
        ]
      : []
  })
  return {
    groups,
    layout: pruneTabGroupLayout(state.layout, new Set(groups.map((group) => group.id))),
    focusedGroupId: groups.some((group) => group.id === state.focusedGroupId)
      ? state.focusedGroupId
      : (groups[0]?.id ?? null)
  }
}

/** Presentation only: never move a backing tab between execution owners. */
export function openSessionPanelTab(
  state: SessionPanelLayout,
  key: string,
  options: { groupId?: string; zone?: TabDropZone; append?: boolean; newGroupId: string }
): SessionPanelLayout {
  const existing = state.groups.find((group) => group.keys.includes(key))
  if (existing && !options.append) {
    if (existing.activeKey === key && state.focusedGroupId === existing.id) {
      return state
    }
    return {
      ...state,
      focusedGroupId: existing.id,
      groups: state.groups.map((group) =>
        group === existing ? { ...group, activeKey: key } : group
      )
    }
  }
  const targetId = options.groupId ?? state.focusedGroupId
  let target = state.groups.find((group) => group.id === targetId)
  if (options.groupId && !target) {
    return state
  }
  if (existing === target && target?.keys.length === 1) {
    return state
  }
  const next = existing ? closeSessionPanelTab(state, key) : state
  target = next.groups.find((group) => group.id === targetId)
  if (!target || !next.layout) {
    const group = { id: options.newGroupId, keys: [key], activeKey: key }
    return {
      layout: { type: 'leaf', groupId: group.id },
      groups: [group],
      focusedGroupId: group.id
    }
  }
  const zone = options.zone ?? 'center'
  if (zone !== 'center') {
    const group = { id: options.newGroupId, keys: [key], activeKey: key }
    return {
      groups: [...next.groups, group],
      focusedGroupId: group.id,
      layout: replaceLeaf(
        next.layout,
        target.id,
        buildSplitNode(
          target.id,
          group.id,
          zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical',
          zone === 'left' || zone === 'up' ? 'first' : 'second'
        )
      )
    }
  }
  return {
    ...next,
    focusedGroupId: target.id,
    groups: next.groups.map((group) =>
      group.id !== target.id
        ? group
        : {
            ...group,
            activeKey: key,
            keys: options.append
              ? [...group.keys, key]
              : group.keys.map((candidate) => (candidate === group.activeKey ? key : candidate))
          }
    )
  }
}

export function resizeSessionPanel(
  state: SessionPanelLayout,
  path: string,
  ratio: number
): SessionPanelLayout {
  return state.layout
    ? { ...state, layout: updateSplitRatio(state.layout, path ? path.split('.') : [], ratio) }
    : state
}
