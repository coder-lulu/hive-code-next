import type { CSSProperties } from 'react'

export const SESSION_DETAIL_ANCHOR_NAME = '--hive-session-detail'

export function sessionPanelAnchorName(groupId?: string): string {
  return groupId ? `${SESSION_DETAIL_ANCHOR_NAME}-${groupId}` : SESSION_DETAIL_ANCHOR_NAME
}

export const sessionDetailAnchorStyle: CSSProperties = {
  anchorName: SESSION_DETAIL_ANCHOR_NAME
}
