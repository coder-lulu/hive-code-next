import { z } from 'zod'
import { randomUUID } from 'expo-crypto'
import {
  acquireHiveAccountRelayMaterial,
  type HiveAccountRelayMaterial
} from '../../../src/shared/hive-account-relay-material'
import { mobileRuntimeRandomBytes } from '../transport/runtime-random'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { isRecord, request, requestWithMetadata } from '../auth/mobile-sms-client'
import {
  AccountRuntimeDirectoryEntrySchema,
  RuntimePresenceEntrySchema,
  RuntimeSessionSchema,
  type AccountRuntimeDirectoryEntry,
  type RuntimePresenceEntry,
  type RuntimeSession,
  type RuntimeSessionPage,
  type RuntimeSessionRevocation
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
  session: MobileSession,
  runtimeRecordId: string,
  expectedResourceVersion: number,
  signal?: AbortSignal
): Promise<HiveAccountRelayMaterial> {
  CanonicalUuidSchema.parse(runtimeRecordId)
  if (signal?.aborted) {
    throw new Error('runtime_connection_cancelled')
  }
  return acquireHiveAccountRelayMaterial({
    randomBytes: mobileRuntimeRandomBytes,
    clientKind: 'MOBILE',
    expectedResourceVersion,
    createIntent: (body) =>
      request<unknown>(
        `/hive/v1/runtimes/${encodeURIComponent(runtimeRecordId)}/connection-intents`,
        body,
        { headers: bearerHeaders(session.accessToken), signal }
      )
  })
}

export async function loadRuntimeSessions(
  session: MobileSession,
  cursor: string | null = null
): Promise<RuntimeSessionPage> {
  if (cursor !== null) {
    parseNextCursor({ nextCursor: cursor })
  }
  const query = new URLSearchParams({ limit: '25' })
  if (cursor) {
    query.set('cursor', cursor)
  }
  const response = await requestWithMetadata<unknown>(
    `/hive/v1/runtime-sessions?${query}`,
    undefined,
    {
      method: 'GET',
      headers: bearerHeaders(session.accessToken)
    }
  )
  const page = z
    .object({ items: z.array(RuntimeSessionSchema).max(25), nextCursor: z.string().nullable() })
    .strict()
    .parse(response.value)
  const nextCursor = parseNextCursor(page)
  if (nextCursor !== null && nextCursor === cursor) {
    throw new Error('runtime_session_cursor_loop')
  }
  if (new Set(page.items.map((item) => item.managedSessionId)).size !== page.items.length) {
    throw new Error('runtime_session_response_duplicate')
  }
  return { items: page.items, nextCursor }
}

export async function revokeRuntimeSession(
  session: MobileSession,
  target: Pick<RuntimeSession, 'managedSessionId' | 'resourceVersion'>
): Promise<RuntimeSessionRevocation> {
  CanonicalUuidSchema.parse(target.managedSessionId)
  if (!Number.isSafeInteger(target.resourceVersion) || target.resourceVersion < 1) {
    throw new Error('runtime_session_resource_version_invalid')
  }
  const operationId = randomUUID()
  const value = await request<unknown>(
    `/hive/v1/runtime-sessions/${encodeURIComponent(target.managedSessionId)}/revoke`,
    {
      protocolVersion: 'account-runtime-session-revoke/v2',
      operationId,
      expectedResourceVersion: target.resourceVersion
    },
    { headers: bearerHeaders(session.accessToken) }
  )
  const revoked = z
    .object({
      protocolVersion: z.literal('account-runtime-session-revoke/v2'),
      operationId: z.literal(operationId),
      managedSessionId: CanonicalUuidSchema,
      status: z.enum(['REVOKE_PENDING', 'REVOKED']),
      resourceVersion: z.number().int().positive(),
      controlVersion: z.number().int().positive()
    })
    .strict()
    .parse(value)
  if (revoked.managedSessionId !== target.managedSessionId) {
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
