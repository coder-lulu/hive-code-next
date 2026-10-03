import { describe, expect, it, vi } from 'vitest'
import type { FilesystemApi } from '../../../preload/api/filesystem-api'
import type { RuntimeApi } from '../../../preload/api/runtime-api'
import type { AgentJournalRenderItem } from '../../../shared/agent-session-journal-types'
import type {
  AgentSessionHistoryPage,
  AgentSessionHistoryResult
} from '../../../shared/agent-session-wire'
import { createHiveAgentSessionClient } from './hive-agent-session-client'
import { exportHiveAgentConversation } from './hive-agent-conversation-export'

const sessionId = 'ha-session:12345678-1234-4234-8234-123456789abc'
const session = {
  schemaVersion: 1,
  sessionId,
  profileId: 'personal',
  createdAt: 1,
  updatedAt: 1,
  visibility: 'private',
  retention: 'until-deleted',
  stateRevision: 0
}
const cursor = (sequence: number, epoch = 'epoch') => ({ epoch, sequence })
const item = (sequence: number): AgentJournalRenderItem => ({
  itemId: `item-${sequence}`,
  revision: 1,
  sequence,
  observedAt: sequence,
  body: {
    kind: 'message',
    role: sequence % 2 ? 'user' : 'assistant',
    blocks: [{ type: 'text', text: `消息 ${sequence}` }]
  }
})
const page = (older: boolean): AgentSessionHistoryPage => ({
  sessionId,
  epoch: 'epoch',
  direction: older ? 'before' : 'tail',
  items: older ? [item(1), item(2)] : [item(3), item(4)],
  submissions: [],
  removedItemIds: [],
  window: {
    oldest: cursor(older ? 1 : 3),
    newest: cursor(older ? 2 : 4),
    nextCursor: cursor(older ? 1 : 3)
  },
  liveCursor: cursor(4),
  hasOlder: !older,
  hasNewer: older
})
function fixture() {
  const controller = new AbortController()
  const history = vi.fn<(older: boolean) => Promise<AgentSessionHistoryResult>>(async (older) => ({
    ok: true,
    page: page(older)
  }))
  const call = vi.fn<RuntimeApi['runtime']['call']>(async (args) => ({
    id: 'request',
    ok: true,
    _meta: { runtimeId: 'local' },
    result: {
      ok: true,
      value:
        args.method === 'hiveAgent.read'
          ? { session }
          : await history(
              (args.params as { params: { direction: string } }).params.direction === 'before'
            )
    }
  }))
  const client = createHiveAgentSessionClient({
    projectSelector: 'workspace',
    signal: controller.signal,
    call
  })
  const files = {
    startDownloadedFile: vi.fn<FilesystemApi['fs']['startDownloadedFile']>(async () => ({
      canceled: false,
      transferId: 'transfer',
      destinationPath: 'export.json'
    })),
    appendDownloadedFileChunk: vi.fn<FilesystemApi['fs']['appendDownloadedFileChunk']>(
      async () => ({ ok: true })
    ),
    finishDownloadedFile: vi.fn<FilesystemApi['fs']['finishDownloadedFile']>(async () => ({
      canceled: false,
      destinationPath: 'export.json'
    })),
    cancelDownloadedFile: vi.fn<FilesystemApi['fs']['cancelDownloadedFile']>(async () => ({
      ok: true
    }))
  }
  return {
    controller,
    history,
    call,
    files,
    run: () => exportHiveAgentConversation({ client, files, sessionId, signal: controller.signal })
  }
}
describe('HiveAgent private conversation export', () => {
  it('exports all pages in journal order through the existing atomic file transfer', async () => {
    const f = fixture()
    await expect(f.run()).resolves.toEqual({ canceled: false, destinationPath: 'export.json' })
    const content = Buffer.concat(
      f.files.appendDownloadedFileChunk.mock.calls.map(([args]) =>
        Buffer.from(args.contentBase64, 'base64')
      )
    ).toString('utf8')
    const archive = JSON.parse(content)
    expect(archive.items).toEqual([item(1), item(2), item(3), item(4)])
    expect(Object.keys(archive).sort()).toEqual([
      'createdAt',
      'exportedAt',
      'format',
      'generationState',
      'items',
      'sessionId',
      'version'
    ])
    expect(f.history).toHaveBeenCalledTimes(3)
    expect(f.files.finishDownloadedFile).toHaveBeenCalledExactlyOnceWith({ transferId: 'transfer' })
    expect(f.files.cancelDownloadedFile).not.toHaveBeenCalled()
  })
  it.each(['head', 'cursor', 'duplicate'] as const)(
    'rejects %s drift before opening the file dialog',
    async (fault) => {
      const f = fixture()
      f.history.mockImplementation(async (older) => ({
        ok: true,
        page: older
          ? {
              ...page(true),
              ...(fault === 'head' ? { liveCursor: cursor(5) } : {}),
              ...(fault === 'cursor'
                ? { hasOlder: true, window: { ...page(true).window, nextCursor: cursor(3) } }
                : {}),
              ...(fault === 'duplicate' ? { items: [item(3)] } : {})
            }
          : page(false)
      }))
      await expect(f.run()).rejects.toThrow('hive_agent_export_changed')
      expect(f.files.startDownloadedFile).not.toHaveBeenCalled()
    }
  )
  it('rejects a reset instead of exporting the recovery tail as complete history', async () => {
    const f = fixture()
    f.history.mockResolvedValue({ ok: false, reset: 'epoch_changed', page: page(false) } as Awaited<
      ReturnType<typeof f.history>
    >)
    await expect(f.run()).rejects.toThrow('hive_agent_export_changed')
    expect(f.files.startDownloadedFile).not.toHaveBeenCalled()
  })
  it('does not write after the user cancels the native dialog', async () => {
    const f = fixture()
    f.files.startDownloadedFile.mockResolvedValue({ canceled: true })
    await expect(f.run()).resolves.toEqual({ canceled: true })
    expect(f.files.appendDownloadedFileChunk).not.toHaveBeenCalled()
    expect(f.files.finishDownloadedFile).not.toHaveBeenCalled()
  })
  it('refuses a host truncation marker instead of exporting it as original content', async () => {
    const f = fixture()
    f.history.mockResolvedValue({
      ok: true,
      page: {
        ...page(false),
        hasOlder: false,
        items: [
          {
            ...item(1),
            body: {
              kind: 'status',
              presentation: 'history-truncated',
              text: 'History item exceeds the page budget'
            }
          }
        ]
      }
    } as Awaited<ReturnType<typeof f.history>>)
    await expect(f.run()).rejects.toThrow('hive_agent_export_too_large')
    expect(f.files.startDownloadedFile).not.toHaveBeenCalled()
  })
  it('bounds the aggregate item count before opening the save dialog', async () => {
    const f = fixture()
    f.history.mockResolvedValue({
      ok: true,
      page: {
        ...page(false),
        hasOlder: false,
        liveCursor: cursor(25001),
        items: Array.from({ length: 25001 }, (_, index) => item(index + 1))
      }
    })
    await expect(f.run()).rejects.toThrow('hive_agent_export_too_large')
    expect(f.files.startDownloadedFile).not.toHaveBeenCalled()
  })
  it('cleans the transfer if identity changes while the native dialog is open', async () => {
    const f = fixture()
    f.files.startDownloadedFile.mockImplementation(async () => {
      f.controller.abort()
      return { canceled: false, transferId: 'transfer', destinationPath: 'export.json' }
    })
    await expect(f.run()).rejects.toThrow('hive_agent_forbidden')
    expect(f.files.appendDownloadedFileChunk).not.toHaveBeenCalled()
    expect(f.files.cancelDownloadedFile).toHaveBeenCalledExactlyOnceWith({ transferId: 'transfer' })
  })
  it('cancels partial output after an append failure and never retries the write', async () => {
    const f = fixture()
    f.files.appendDownloadedFileChunk.mockRejectedValue(new Error('disk unavailable'))
    await expect(f.run()).rejects.toThrow('disk unavailable')
    expect(f.files.appendDownloadedFileChunk).toHaveBeenCalledOnce()
    expect(f.files.finishDownloadedFile).not.toHaveBeenCalled()
    expect(f.files.cancelDownloadedFile).toHaveBeenCalledOnce()
  })
})
