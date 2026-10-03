import type { FilesystemApi } from '../../../preload/api/filesystem-api'
import type {
  AgentJournalCursor,
  AgentJournalRenderItem
} from '../../../shared/agent-session-journal-types'
import type { createHiveAgentSessionClient } from './hive-agent-session-client'

type Client = ReturnType<typeof createHiveAgentSessionClient>
type Files = Pick<
  FilesystemApi['fs'],
  | 'startDownloadedFile'
  | 'appendDownloadedFileChunk'
  | 'finishDownloadedFile'
  | 'cancelDownloadedFile'
>
const MAX_EXPORT_BYTES = 32 * 1024 * 1024
const MAX_EXPORT_ITEMS = 25000
const encoder = new TextEncoder()
const sameCursor = (a: AgentJournalCursor | undefined, b: AgentJournalCursor) =>
  a?.epoch === b.epoch && a.sequence === b.sequence
const unavailable = () => new Error('hive_agent_export_changed')

/** Export one stable journal snapshot; never turn a truncated/reset page into a complete archive. */
export async function exportHiveAgentConversation(options: {
  client: Client
  sessionId: string
  signal: AbortSignal
  files: Files
}) {
  const { client, sessionId, signal, files } = options
  const current = () => {
    if (signal.aborted) {
      throw new Error('hive_agent_forbidden')
    }
  }
  current()
  const before = await client.read(sessionId)
  current()
  if (['PENDING', 'RUNNING'].includes(before.generation?.state ?? '')) {
    throw unavailable()
  }
  const items = new Map<string, AgentJournalRenderItem>()
  let byteLength = 0
  let cursor: AgentJournalCursor | undefined
  let head: AgentJournalCursor | undefined
  for (let pageNumber = 0; ; pageNumber++) {
    current()
    if (pageNumber >= 1024) {
      throw new Error('hive_agent_export_too_large')
    }
    const result = await client.exportPage({
      sessionId,
      direction: cursor ? 'before' : 'tail',
      cursor,
      limit: 100
    })
    current()
    if (!result.ok || !result.page.liveCursor) {
      throw unavailable()
    }
    const page = result.page
    head ??= page.liveCursor
    if (!head || !sameCursor(page.liveCursor, head)) {
      throw unavailable()
    }
    for (const item of page.items) {
      if (item.body.kind === 'status' && item.body.presentation === 'history-truncated') {
        throw new Error('hive_agent_export_too_large')
      }
      if (items.has(item.itemId) || (cursor && item.sequence >= cursor.sequence)) {
        throw unavailable()
      }
      byteLength += encoder.encode(JSON.stringify(item)).byteLength
      if (byteLength > MAX_EXPORT_BYTES || items.size >= MAX_EXPORT_ITEMS) {
        throw new Error('hive_agent_export_too_large')
      }
      items.set(item.itemId, item)
    }
    if (!page.hasOlder) {
      break
    }
    const next = page.window.nextCursor
    if (!page.items.length || next.sequence <= 0 || (cursor && next.sequence >= cursor.sequence)) {
      throw unavailable()
    }
    cursor = next
  }
  const [after, finalPage] = await Promise.all([
    client.read(sessionId),
    client.exportPage({ sessionId, direction: 'tail', limit: 1 })
  ])
  current()
  if (
    after.session.stateRevision !== before.session.stateRevision ||
    !finalPage.ok ||
    !head ||
    !sameCursor(finalPage.page.liveCursor, head)
  ) {
    throw unavailable()
  }
  const content = encoder.encode(
    JSON.stringify({
      format: 'hivecode-conversation',
      version: 1,
      exportedAt: new Date().toISOString(),
      sessionId,
      createdAt: before.session.createdAt,
      generationState: before.generation?.state ?? null,
      items: [...items.values()].sort((a, b) => a.sequence - b.sequence)
    })
  )
  if (content.byteLength > MAX_EXPORT_BYTES) {
    throw new Error('hive_agent_export_too_large')
  }
  const download = await files.startDownloadedFile({
    suggestedName: `hivecode-conversation-${new Date(before.session.createdAt).toISOString().replaceAll(':', '-')}.json`
  })
  if (download.canceled) {
    return download
  }
  let finished = false
  try {
    current()
    // The native save dialog may outlive the login that requested this private export.
    await client.read(sessionId)
    current()
    for (let offset = 0; offset < content.byteLength; offset += 64 * 1024) {
      const chunk = content.subarray(offset, offset + 64 * 1024)
      let binary = ''
      for (const byte of chunk) {
        binary += String.fromCharCode(byte)
      }
      await files.appendDownloadedFileChunk({
        transferId: download.transferId,
        contentBase64: btoa(binary)
      })
      current()
    }
    const result = await files.finishDownloadedFile({ transferId: download.transferId })
    finished = true
    return result
  } finally {
    if (!finished) {
      await files.cancelDownloadedFile({ transferId: download.transferId }).catch(() => {})
    }
  }
}
