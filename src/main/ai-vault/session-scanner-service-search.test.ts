import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { AiVaultSearchResponse, AiVaultSearchStatus } from '../../shared/ai-vault-search-types'
import {
  openSessionSearchIndexerHarness,
  writeClaudeTranscript,
  type SessionSearchIndexerHarness
} from '../ai-vault-search/session-search-indexer-test-fixture'
import {
  AI_VAULT_SERVICE_PROTOCOL_VERSION,
  type AiVaultServiceChildMessage,
  type AiVaultServiceParentMessage,
  type AiVaultServiceRequestBody,
  type AiVaultServiceResultValue,
  type AiVaultSessionSearchInit
} from './session-scanner-service-protocol'

/**
 * The child, booted the way a spawn boots it: an init frame and messages, with
 * no renderer, no Electron and no scan request. What this proves is that consent
 * alone constructs the indexer and that every search answer crosses the protocol.
 */

const SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

let harness: SessionSearchIndexerHarness
let currentRoots: SessionSearchIndexerHarness['roots']
let originalSendDescriptor: PropertyDescriptor | undefined
let entryMessageListener: ReturnType<typeof process.listeners>[number] | undefined
const originalMessageListeners = new Set<ReturnType<typeof process.listeners>[number]>()
const originalDisconnectListeners = new Set<ReturnType<typeof process.listeners>[number]>()
const ownedMessageListeners = new Set<ReturnType<typeof process.listeners>[number]>()
const ownedDisconnectListeners = new Set<ReturnType<typeof process.listeners>[number]>()
const unrelatedParentFrames = vi.fn()
const sent: AiVaultServiceChildMessage[] = []
let nextId = 1

function emit(message: AiVaultServiceParentMessage): void {
  if (!entryMessageListener || !process.listeners('message').includes(entryMessageListener)) {
    throw new Error('Expected the owned AI Vault service entry listener')
  }
  entryMessageListener.call(process, message, undefined)
}

/** One request, and the reply the child sent for it, still discriminated by operation. */
async function call(body: AiVaultServiceRequestBody): Promise<AiVaultServiceResultValue> {
  const id = nextId++
  emit({ ...body, id })
  const reply = await vi.waitFor(() => {
    const found = sent.find(
      (message) => (message.type === 'result' || message.type === 'error') && message.id === id
    )
    expect(found).toBeDefined()
    return found!
  })
  if (reply.type === 'error') {
    throw new Error(reply.message)
  }
  if (reply.type !== 'result') {
    throw new Error(`expected a result, got ${reply.type}`)
  }
  return reply
}

async function searchStatus(): Promise<AiVaultSearchStatus> {
  const reply = await call({ type: 'request', operation: 'searchStatus' })
  if (reply.operation !== 'searchStatus') {
    throw new Error(`expected searchStatus, got ${reply.operation}`)
  }
  return reply.value
}

async function searchSessions(query: string): Promise<AiVaultSearchResponse> {
  const reply = await call({ type: 'request', operation: 'searchSessions', request: { query } })
  if (reply.operation !== 'searchSessions') {
    throw new Error(`expected searchSessions, got ${reply.operation}`)
  }
  return reply.value
}

function searchInit(enabled: boolean): AiVaultSessionSearchInit {
  return {
    databasePath: harness.databasePath,
    settings: { enabled, historyDays: null },
    roots: harness.roots
  }
}

beforeAll(async () => {
  originalSendDescriptor = Object.getOwnPropertyDescriptor(process, 'send')
  process.on('message', unrelatedParentFrames)
  for (const listener of process.listeners('message')) {
    originalMessageListeners.add(listener)
  }
  for (const listener of process.listeners('disconnect')) {
    originalDisconnectListeners.add(listener)
  }
  harness = await openSessionSearchIndexerHarness('ss-child')
  currentRoots = harness.roots
  await writeClaudeTranscript(
    join(harness.claudeProjectDir, `${SESSION_ID}.jsonl`),
    ['a distinctive conversation'],
    SESSION_ID
  )
  const record: NonNullable<typeof process.send> = (message) => {
    sent.push(message)
    if (message.type === 'sessionSearchRoots') {
      const ownedRootsListeners = process
        .listeners('message')
        .filter(
          (listener) =>
            !originalMessageListeners.has(listener) && !ownedMessageListeners.has(listener)
        )
      expect(ownedRootsListeners).toHaveLength(1)
      const replyListener = ownedRootsListeners[0]
      if (!replyListener) {
        throw new Error('Expected the owned session search roots reply listener')
      }
      ownedMessageListeners.add(replyListener)
      queueMicrotask(() => {
        if (process.listeners('message').includes(replyListener)) {
          replyListener.call(
            process,
            { type: 'sessionSearchRoots', id: message.id, roots: currentRoots },
            undefined
          )
        }
      })
    }
    return true
  }
  process.send = record
  await import('./session-scanner-service-entry')
  const ownedEntryListeners = process
    .listeners('message')
    .filter((listener) => !originalMessageListeners.has(listener))
  expect(ownedEntryListeners).toHaveLength(1)
  entryMessageListener = ownedEntryListeners[0]
  if (!entryMessageListener) {
    throw new Error('Expected the owned AI Vault service entry listener')
  }
  ownedMessageListeners.add(entryMessageListener)
  const ownedEntryDisconnectListeners = process
    .listeners('disconnect')
    .filter((listener) => !originalDisconnectListeners.has(listener))
  expect(ownedEntryDisconnectListeners).toHaveLength(1)
  for (const listener of ownedEntryDisconnectListeners) {
    ownedDisconnectListeners.add(listener)
  }
  emit({
    type: 'init',
    protocol: AI_VAULT_SERVICE_PROTOCOL_VERSION,
    sessionParseCache: null,
    sessionSearch: searchInit(true)
  })
  await vi.waitFor(() => expect(sent.some((message) => message.type === 'ready')).toBe(true))
})

afterAll(async () => {
  try {
    if (entryMessageListener) {
      emit({ type: 'sessionSearch', init: searchInit(false) })
    }
  } finally {
    try {
      if (originalSendDescriptor) {
        Object.defineProperty(process, 'send', originalSendDescriptor)
      } else {
        Reflect.deleteProperty(process, 'send')
      }
      for (const listener of ownedMessageListeners) {
        process.removeListener('message', listener)
      }
      for (const listener of ownedDisconnectListeners) {
        process.removeListener('disconnect', listener)
      }
      process.removeListener('message', unrelatedParentFrames)
      entryMessageListener = undefined
      expect(process.listeners('message')).toEqual(
        expect.arrayContaining(
          [...originalMessageListeners].filter((listener) => listener !== unrelatedParentFrames)
        )
      )
      expect(process.listeners('disconnect')).toEqual(
        expect.arrayContaining([...originalDisconnectListeners])
      )
    } finally {
      await harness?.cleanup()
    }
  }
})

it('reports the indexer phase and a live generation over the protocol', async () => {
  const status = await vi.waitFor(async () => {
    const value = await searchStatus()
    expect(value.filesIndexed).toBeGreaterThan(0)
    expect(value.phase).toBe('current')
    expect(value.generation).toBeGreaterThan(0)
    return value
  })
  expect(status.enabled).toBe(true)
  expect(existsSync(harness.databasePath)).toBe(true)
})

it('answers a search and a reconcile over the protocol', async () => {
  expect(await call({ type: 'request', operation: 'searchReconcile' })).toEqual({
    operation: 'searchReconcile',
    value: null,
    type: 'result',
    id: expect.any(Number)
  })
  const response = await searchSessions('distinctive')
  expect(response.kind).toBe('results')
  if (response.kind === 'results') {
    expect(response.hits.map((hit) => hit.sessionId)).toEqual([SESSION_ID])
  }
})

it('discovers a new root through the parent exchange on manual reconciliation', async () => {
  const lateHome = join(harness.root, 'late-home')
  const id = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
  await writeClaudeTranscript(
    join(lateHome, '.claude', 'projects', 'late', `${id}.jsonl`),
    ['freshroots'],
    id
  )
  currentRoots = { ...harness.roots, wslHomeDirs: [lateHome] }
  await call({ type: 'request', operation: 'searchReconcile' })
  const response = await searchSessions('freshroots')
  expect(response.kind).toBe('results')
  if (response.kind === 'results') {
    expect(response.hits.map((hit) => hit.sessionId)).toEqual([id])
  }
})

it('clears the owned index and rebuilds from the transcripts still on disk', async () => {
  const transcriptPath = join(harness.claudeProjectDir, `${SESSION_ID}.jsonl`)
  expect((await searchSessions('distinctive')).kind).toBe('results')
  rmSync(transcriptPath)

  expect(await call({ type: 'request', operation: 'searchClear' })).toEqual({
    operation: 'searchClear',
    value: null,
    type: 'result',
    id: expect.any(Number)
  })
  expect(await searchSessions('distinctive')).toMatchObject({ kind: 'results', hits: [] })
  expect(existsSync(harness.databasePath)).toBe(true)
})

it('answers disabled once consent is withdrawn, without a respawn', async () => {
  emit({ type: 'sessionSearch', init: searchInit(false) })
  expect(await searchSessions('distinctive')).toEqual({ kind: 'unavailable', reason: 'disabled' })
  expect(await searchStatus()).toMatchObject({ enabled: false, phase: 'idle' })
  // Re-consenting reuses the index that was left on disk rather than rebuilding it.
  emit({ type: 'sessionSearch', init: searchInit(true) })
  expect((await searchSessions('distinctive')).kind).toBe('results')
})

it('preserves pre-existing IPC listeners without delivering service parent frames to them', () => {
  expect(process.listeners('message')).toEqual(
    expect.arrayContaining([...originalMessageListeners])
  )
  expect(process.listeners('disconnect')).toEqual(
    expect.arrayContaining([...originalDisconnectListeners])
  )
  expect(
    unrelatedParentFrames.mock.calls.filter(([message]) => typeof message !== 'string')
  ).toEqual([])
})
