import { EventEmitter } from 'node:events'
import { utimesSync, writeFileSync, type FSWatcher } from 'node:fs'
import type * as NodeFs from 'node:fs'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../shared/native-chat-types'

const { watchCallbacks, watchMock } = vi.hoisted(() => ({
  watchCallbacks: [] as ((event: string, filename: string | Buffer | null) => void)[],
  watchMock: vi.fn()
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  watchMock.mockImplementation((_path, callback) => {
    watchCallbacks.push(callback)
    return Object.assign(new EventEmitter(), {
      close: vi.fn(),
      unref: vi.fn()
    }) as unknown as FSWatcher
  })
  return { ...actual, watch: watchMock }
})

import * as FileVersion from './transcript-file-version'
import * as TailReader from './transcript-tail-reader'
import { subscribeNativeChatTranscript } from './transcript-watch'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  watchCallbacks.length = 0
  watchMock.mockClear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function claudeLine(uuid: string, role: 'user' | 'assistant', text: string): string {
  return `${JSON.stringify({
    type: role,
    uuid,
    timestamp: '2026-06-01T10:00:00.000Z',
    message: { role, content: role === 'user' ? text : [{ type: 'text', text }] }
  })}\n`
}

async function tempFile(initial: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-native-chat-read-version-'))
  roots.push(root)
  const filePath = join(root, 'transcript.jsonl')
  await writeFile(filePath, initial)
  return filePath
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > 5_000) {
      throw new Error('timed out waiting for the owned read phase')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function changeEvent(): void {
  watchCallbacks[0]!('change', 'transcript.jsonl')
}

function sameSizeRewrite(): { before: string; after: string } {
  const before = claudeLine('prefix-old', 'user', 'before')
  const after = claudeLine('prefix-new', 'user', 'after!')
  const stableTail = claudeLine('stable-tail', 'assistant', 'x'.repeat(200))
  expect(Buffer.byteLength(after)).toBe(Buffer.byteLength(before))
  return { before: before + stableTail, after: after + stableTail }
}

describe('native chat transcript watcher stable read versions', () => {
  it('reconciles a same-size rewrite made synchronously by the initial snapshot callback', async () => {
    const content = sameSizeRewrite()
    const filePath = await tempFile(content.before)
    const replacements = vi.fn<(messages: NativeChatMessage[]) => void>()
    const appends = vi.fn<(messages: NativeChatMessage[]) => void>()
    const snapshots = vi.fn(() => {
      writeFileSync(filePath, content.after)
      const future = new Date(Date.now() + 10_000)
      utimesSync(filePath, future, future)
      changeEvent()
    })
    const subscription = await subscribeNativeChatTranscript({
      agent: 'claude',
      sessionId: 'session',
      filePath,
      initialLimit: 40,
      onInitialSnapshot: snapshots,
      onReplace: replacements,
      onAppend: appends,
      debounceMs: 0,
      reconciliationIntervalMs: 10_000
    })
    try {
      await waitFor(() =>
        replacements.mock.calls.some(([messages]) => messages[0]?.id === 'prefix-new')
      )
      expect(snapshots).toHaveBeenCalledOnce()
      expect(replacements.mock.calls[0]![0].map((message) => message.id)).toEqual([
        'prefix-new',
        'stable-tail'
      ])
      expect(replacements.mock.calls[0]![0][0]!.blocks).toEqual([{ type: 'text', text: 'after!' }])
      expect(replacements.mock.calls[0]![0][1]!.blocks).toEqual([
        { type: 'text', text: 'x'.repeat(200) }
      ])
      await appendFile(filePath, claudeLine('followup', 'assistant', 'delivered once'))
      changeEvent()
      changeEvent()
      await waitFor(() =>
        appends.mock.calls.some(([messages]) =>
          messages.some((message) => message.id === 'followup')
        )
      )
      expect(replacements).toHaveBeenCalledOnce()
      expect(
        appends.mock.calls
          .flatMap(([messages]) => messages)
          .filter((message) => message.id === 'followup')
      ).toHaveLength(1)
    } finally {
      subscription.unsubscribe()
    }
  })

  it('discards an unstable replacement read and publishes its stable successor once', async () => {
    const content = sameSizeRewrite()
    const filePath = await tempFile(content.before)
    const snapshots = vi.fn()
    const replacements = vi.fn<(messages: NativeChatMessage[]) => void>()
    const appends = vi.fn<(messages: NativeChatMessage[]) => void>()
    const readVersion = FileVersion.readTranscriptFileVersion
    const readTail = TailReader.readNativeChatTranscriptTailFile
    let initialFinishObserved = false
    let replacementReadStarted = false
    let replacementReadCompleted = false
    let replacementReads = 0
    let releaseRead: () => void = () => {}
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const versionSpy = vi
      .spyOn(FileVersion, 'readTranscriptFileVersion')
      .mockImplementation(async (...args) => {
        const version = await readVersion(...args)
        if (snapshots.mock.calls.length === 1 && !replacementReadStarted) {
          initialFinishObserved = true
        }
        return version
      })
    const tailSpy = vi
      .spyOn(TailReader, 'readNativeChatTranscriptTailFile')
      .mockImplementation(async (...args) => {
        const snapshot = await readTail(...args)
        if (replacementReadStarted) {
          replacementReads += 1
          if (replacementReads === 1) {
            replacementReadCompleted = true
            await readGate
          }
        }
        return snapshot
      })
    const subscription = await subscribeNativeChatTranscript({
      agent: 'claude',
      sessionId: 'session',
      filePath,
      initialLimit: 40,
      onInitialSnapshot: snapshots,
      onReplace: replacements,
      onAppend: appends,
      debounceMs: 0,
      reconciliationIntervalMs: 10_000
    })
    try {
      await waitFor(() => initialFinishObserved)
      replacementReadStarted = true
      writeFileSync(filePath, content.after)
      changeEvent()
      await waitFor(() => replacementReadCompleted)
      expect(replacements).not.toHaveBeenCalled()
      const future = new Date(Date.now() + 10_000)
      utimesSync(filePath, future, future)
      releaseRead()
      await waitFor(() => replacements.mock.calls.length > 0)
      expect(replacementReads).toBe(2)
      expect(replacements.mock.calls[0]![0].map((message) => message.id)).toEqual([
        'prefix-new',
        'stable-tail'
      ])
      expect(replacements.mock.calls[0]![0][0]!.blocks).toEqual([{ type: 'text', text: 'after!' }])
      expect(replacements.mock.calls[0]![0][1]!.blocks).toEqual([
        { type: 'text', text: 'x'.repeat(200) }
      ])
      await appendFile(filePath, claudeLine('followup', 'assistant', 'delivered once'))
      changeEvent()
      changeEvent()
      await waitFor(() =>
        appends.mock.calls.some(([messages]) =>
          messages.some((message) => message.id === 'followup')
        )
      )
      expect(snapshots).toHaveBeenCalledOnce()
      expect(replacements).toHaveBeenCalledOnce()
      expect(
        appends.mock.calls
          .flatMap(([messages]) => messages)
          .filter((message) => message.id === 'followup')
      ).toHaveLength(1)
    } finally {
      releaseRead()
      subscription.unsubscribe()
      tailSpy.mockRestore()
      versionSpy.mockRestore()
    }
  })
})
