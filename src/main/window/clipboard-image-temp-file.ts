import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import { getAppEnvironment } from '../../shared/app-environment'
import {
  assertClipboardImageByteLengthWithinLimit,
  CLIPBOARD_IMAGE_TEMP_FILE_PREFIX
} from '../../shared/clipboard-image'
import {
  sanitizeAgentSessionAttachmentName,
  type AgentSessionAttachmentClipboardTarget
} from '../../shared/agent-session-attachments'
import { nativeChatPasteFolder } from './native-chat-paste-files'

export type SaveClipboardImageAsTempFileArgs = {
  connectionId?: string | null
  /** Original picked-file name; retained only after shell-safe basename sanitization. */
  fileName?: string
  runtimeEnvironmentId?: string | null
  /** With `runtimeEnvironmentId`: store the image as an attachment of this structured chat. */
  agentSessionAttachment?: AgentSessionAttachmentClipboardTarget
  /** A native-chat composer paste: kept in Orca's paste folder so its draft can bring it back. */
  forNativeChatDraft?: boolean
  forStructuredChat?: boolean
}

export async function saveClipboardImageBufferAsTempFile(
  buffer: Buffer,
  args?: SaveClipboardImageAsTempFileArgs
): Promise<string> {
  assertClipboardImageByteLengthWithinLimit(buffer.byteLength)

  const fileName = `${CLIPBOARD_IMAGE_TEMP_FILE_PREFIX}-${Date.now()}-${randomUUID()}.png`

  if (args?.connectionId) {
    throw new SshHostNotServedError(args.connectionId)
  }

  // Why only a composer paste goes to the paste folder: its draft can bring it back after a
  // restart, while terminal, editor and phone pastes stay in OS temp, as they always have.
  let folder = getAppEnvironment().getPath('temp')
  if (args?.forNativeChatDraft === true) {
    folder = nativeChatPasteFolder()
    await fs.mkdir(folder, { recursive: true })
  }
  const pickedName = args?.fileName
    ? sanitizeAgentSessionAttachmentName(args.fileName).replace(/[^\p{L}\p{M}\p{N} ._-]/gu, '_')
    : null
  const tempPath = pickedName
    ? path.join(folder, `${CLIPBOARD_IMAGE_TEMP_FILE_PREFIX}-${randomUUID()}`, pickedName)
    : path.join(folder, fileName)
  if (pickedName) {
    await fs.mkdir(path.dirname(tempPath), { recursive: true })
  }
  await fs.writeFile(tempPath, buffer)
  return tempPath
}
