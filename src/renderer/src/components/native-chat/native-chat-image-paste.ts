// Pure decision layer for native chat image paste.

import { isClipboardImageTempFileName } from '../../../../shared/clipboard-image'
import { isImageDropPath } from '../terminal-pane/terminal-drop-image-path'
export {
  getAgentImageHandling,
  type AgentImageHandling
} from '../../../../shared/agent-image-paste'

export function isNativeChatImageAttachmentPath(path: string): boolean {
  return isImageDropPath(path)
}

/** True when a path is a clipboard-paste temp file. Those names are noise in
 *  the UI, so the composer shows a friendly label instead of the basename. */
export function isNativeChatPastedImagePath(path: string): boolean {
  const base = path.split(/[\\/]/).findLast(Boolean) ?? path
  return isClipboardImageTempFileName(base)
}
