export type SessionListMetadata = Record<string, { pinned?: boolean; archived?: boolean }>

export function normalizeSessionListMetadata(value: unknown): SessionListMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (!key || !entry || typeof entry !== 'object') {
        return []
      }
      const { pinned, archived } = entry as Record<string, unknown>
      return pinned === true || archived === true
        ? [
            [
              key,
              {
                ...(pinned === true ? { pinned: true } : {}),
                ...(archived === true ? { archived: true } : {})
              }
            ]
          ]
        : []
    })
  )
}

export function partitionSessionList<T extends { key: string }>(
  items: readonly T[],
  metadata: SessionListMetadata
): { active: T[]; archived: T[] } {
  const sorted = [...items].sort(
    (a, b) => Number(metadata[b.key]?.pinned === true) - Number(metadata[a.key]?.pinned === true)
  )
  return {
    active: sorted.filter((item) => !metadata[item.key]?.archived),
    archived: sorted.filter((item) => metadata[item.key]?.archived)
  }
}
