import {
  hiveAgentMethodSchemas,
  hiveAgentSessionListSchema,
  type AuthenticatedRuntimePrincipal
} from '../../shared/hive-agent-session-methods'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'

/** Cursor order uses immutable creation time, so new turns do not move pages. */
export function listHiveAgentSessions(
  entries: HiveAgentSessionEntry[],
  principal: AuthenticatedRuntimePrincipal,
  raw: unknown
) {
  const { before, limit = 30 } = hiveAgentMethodSchemas['hiveAgent.list'].parse(raw)
  const sessions = entries
    .filter(
      (entry) =>
        entry.deletedAt === undefined &&
        entry.accountId === principal.accountId &&
        entry.deviceId === principal.deviceId &&
        entry.projectScope === principal.projectScope
    )
    .map((entry) => entry.aggregate.session)
    .filter(
      (session) =>
        !before ||
        session.createdAt < before.createdAt ||
        (session.createdAt === before.createdAt && session.sessionId < before.sessionId)
    )
    .sort(
      (left, right) =>
        right.createdAt - left.createdAt ||
        (left.sessionId === right.sessionId ? 0 : left.sessionId > right.sessionId ? -1 : 1)
    )
  const page = sessions.slice(0, limit)
  const last = page.at(-1)
  return hiveAgentSessionListSchema.parse({
    sessions: page,
    nextCursor:
      sessions.length > limit && last
        ? { createdAt: last.createdAt, sessionId: last.sessionId }
        : null
  })
}
