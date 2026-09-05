import { z } from 'zod'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { isRecord, randomToken, request, requestWithMetadata } from '../auth/mobile-sms-client'
import {
  AccountRuntimeDirectoryEntrySchema,
  RuntimePresenceEntrySchema,
  RuntimeSessionSchema,
  type AccountRuntimeDirectoryEntry,
  type RuntimePresenceEntry,
  type RuntimeSession
} from './account-runtime-directory-types'

const PAGE_LIMIT = 100
const PRESENCE_BATCH_SIZE = 100
const MAXIMUM_DIRECTORY_ENTRIES = 10_000
const MAXIMUM_PAGES = MAXIMUM_DIRECTORY_ENTRIES / PAGE_LIMIT
const CanonicalUuidSchema = z.uuid().refine((value) => value === value.toLowerCase())
type CursorPage<T> = { readonly items: readonly T[]; readonly nextCursor: string | null }

export async function loadAllAccountRuntimes(
  session: MobileSession,
  fetchPage?: (cursor: string | null) => Promise<CursorPage<AccountRuntimeDirectoryEntry>>,
  signal?: AbortSignal
): Promise<AccountRuntimeDirectoryEntry[]> {
  const loadPage =
    fetchPage ?? ((cursor: string | null) => fetchRuntimePage(session.accessToken, cursor, signal))
  const entries = new Map<string, AccountRuntimeDirectoryEntry>()
  const visitedCursors = new Set<string>()
  let cursor: string | null = null
  let entryCount = 0
  for (let page = 0; page < MAXIMUM_PAGES; page++) {
    const result = await loadPage(cursor)
    for (const entry of result.items) {
      entryCount += 1
      if (entryCount > MAXIMUM_DIRECTORY_ENTRIES) {
        throw new Error('runtime_directory_response_too_large')
      }
      entries.set(entry.runtimeRecordId, entry)
    }
    if (!result.nextCursor) {
      return [...entries.values()]
    }
    if (visitedCursors.has(result.nextCursor)) {
      throw new Error('runtime_directory_cursor_cycle')
    }
    visitedCursors.add(result.nextCursor)
    cursor = result.nextCursor
  }
  throw new Error('runtime_directory_page_limit_exceeded')
}

async function fetchRuntimePage(
  accessToken: string,
  cursor: string | null,
  signal?: AbortSignal
): Promise<CursorPage<AccountRuntimeDirectoryEntry>> {
  const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
  if (cursor) {
    query.set('cursor', cursor)
  }
  const response = await requestWithMetadata<unknown>(`/hive/v1/runtimes?${query}`, undefined, {
    method: 'GET',
    headers: bearerHeaders(accessToken),
    signal
  })
  const items = parseItems(response.value).map((entry) =>
    AccountRuntimeDirectoryEntrySchema.parse(entry)
  )
  return { items, nextCursor: parseDirectoryCursorHeader(response.headers) }
}

export async function loadRuntimePresence(
  session: MobileSession,
  runtimeRecordIds: readonly string[],
  signal?: AbortSignal
): Promise<RuntimePresenceEntry[]> {
  if (runtimeRecordIds.length === 0) {
    return []
  }
  const ids = [...new Set(runtimeRecordIds)].sort()
  ids.forEach((id) => CanonicalUuidSchema.parse(id))
  const entries: RuntimePresenceEntry[] = []
  for (let offset = 0; offset < ids.length; offset += PRESENCE_BATCH_SIZE) {
    const query = new URLSearchParams({
      ids: ids.slice(offset, offset + PRESENCE_BATCH_SIZE).join(',')
    })
    const value = await request<unknown>(`/hive/v1/runtimes/presence?${query}`, undefined, {
      method: 'GET',
      headers: bearerHeaders(session.accessToken),
      signal
    })
    entries.push(...parseItems(value).map((entry) => RuntimePresenceEntrySchema.parse(entry)))
  }
  return entries
}

export async function createAccountRuntimeConnectionIntent(
  _session: MobileSession,
  _runtimeRecordId: string,
  _expectedResourceVersion: number,
  _signal?: AbortSignal
): Promise<never> {
  throw new Error('Account remote connection is not ready.')
}

export async function loadRuntimeSessions(session: MobileSession): Promise<RuntimeSession[]> {
  const sessions: RuntimeSession[] = []
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | null = null
  let pageCount = 0
  do {
    pageCount += 1
    if (pageCount > 100) {
      throw new Error('runtime_session_page_limit_exceeded')
    }
    const path = `/hive/v1/runtime-sessions?limit=100${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    }`
    const response = await requestWithMetadata<unknown>(path, undefined, {
      method: 'GET',
      headers: bearerHeaders(session.accessToken)
    })
    for (const entry of parseItems(response.value)) {
      const parsed = RuntimeSessionSchema.parse(entry)
      if (ids.has(parsed.managedWebSessionId)) {
        throw new Error('runtime_session_response_duplicate')
      }
      ids.add(parsed.managedWebSessionId)
      sessions.push(parsed)
      if (sessions.length > 10_000) {
        throw new Error('runtime_session_response_too_large')
      }
    }
    cursor = parseNextCursor(response.value)
    if (cursor !== null && cursors.has(cursor)) {
      throw new Error('runtime_session_cursor_loop')
    }
    if (cursor !== null) {
      cursors.add(cursor)
    }
  } while (cursor !== null)
  return sessions
}

export async function revokeRuntimeSession(
  session: MobileSession,
  target: Pick<RuntimeSession, 'managedWebSessionId' | 'controlVersion'>
): Promise<RuntimeSession> {
  CanonicalUuidSchema.parse(target.managedWebSessionId)
  if (!Number.isSafeInteger(target.controlVersion) || target.controlVersion < 1) {
    throw new Error('runtime_session_control_version_invalid')
  }
  const value = await request<unknown>(
    `/hive/v1/runtime-sessions/${encodeURIComponent(target.managedWebSessionId)}/revoke`,
    {
      protocolVersion: 'web-session-revoke/v1',
      expectedControlVersion: target.controlVersion,
      reasonCode: 'USER_REQUESTED'
    },
    {
      headers: {
        ...bearerHeaders(session.accessToken),
        'Idempotency-Key': randomToken()
      }
    }
  )
  const revoked = RuntimeSessionSchema.parse(value)
  if (revoked.managedWebSessionId !== target.managedWebSessionId) {
    throw new Error('runtime_session_revoke_target_mismatch')
  }
  return revoked
}

function parseItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }
  if (isRecord(value) && Array.isArray(value.items)) {
    return value.items
  }
  throw new Error('runtime_directory_response_invalid')
}

function parseDirectoryCursorHeader(headers: Headers): string | null {
  const cursor = headers.get('X-Hive-Next-Cursor')
  if (cursor !== null && (!cursor || cursor.length > 256 || /\s|=/.test(cursor))) {
    throw new Error('runtime_directory_cursor_invalid')
  }
  return cursor
}

function parseNextCursor(value: unknown): string | null {
  if (!isRecord(value) || value.nextCursor === undefined || value.nextCursor === null) {
    return null
  }
  if (
    typeof value.nextCursor !== 'string' ||
    value.nextCursor.length === 0 ||
    value.nextCursor.length > 256 ||
    /\s|=/.test(value.nextCursor)
  ) {
    throw new Error('runtime_session_cursor_invalid')
  }
  return value.nextCursor
}

function bearerHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}
