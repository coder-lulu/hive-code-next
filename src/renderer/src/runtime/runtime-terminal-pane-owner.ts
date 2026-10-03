import { makePaneKey, type PaneKey } from '../../../shared/stable-pane-id'
import type { useAppStore } from '../store'

type TerminalLayoutsByTabId = ReturnType<typeof useAppStore.getState>['terminalLayoutsByTabId']
type TerminalPaneOwner = {
  tabId: string
  leafId: string
  paneKey: PaneKey
}

const paneOwnersByPtyIdByLayoutIdentity = new WeakMap<
  TerminalLayoutsByTabId,
  Map<string, TerminalPaneOwner>
>()

export function resolvePaneKeyForPtyId(
  layouts: TerminalLayoutsByTabId,
  ptyId: string
): PaneKey | null {
  let paneOwnersByPtyId = paneOwnersByPtyIdByLayoutIdentity.get(layouts)
  if (!paneOwnersByPtyId) {
    paneOwnersByPtyId = new Map<string, TerminalPaneOwner>()
    paneOwnersByPtyIdByLayoutIdentity.set(layouts, paneOwnersByPtyId)
  }
  const cachedOwner = paneOwnersByPtyId.get(ptyId)
  if (cachedOwner) {
    const layout = Object.prototype.propertyIsEnumerable.call(layouts, cachedOwner.tabId)
      ? layouts[cachedOwner.tabId]
      : undefined
    const ptyIdsByLeafId = layout?.ptyIdsByLeafId
    if (
      ptyIdsByLeafId &&
      Object.prototype.propertyIsEnumerable.call(ptyIdsByLeafId, cachedOwner.leafId) &&
      ptyIdsByLeafId[cachedOwner.leafId] === ptyId
    ) {
      return cachedOwner.paneKey
    }
    paneOwnersByPtyId.delete(ptyId)
  }
  for (const [tabId, layout] of Object.entries(layouts)) {
    for (const [leafId, leafPtyId] of Object.entries(layout?.ptyIdsByLeafId ?? {})) {
      if (leafPtyId !== ptyId) {
        continue
      }
      try {
        const paneKey = makePaneKey(tabId, leafId)
        paneOwnersByPtyId.set(ptyId, { tabId, leafId, paneKey })
        return paneKey
      } catch {
        // Preserve first-match behavior for malformed legacy layout rows.
        return null
      }
    }
  }
  return null
}
