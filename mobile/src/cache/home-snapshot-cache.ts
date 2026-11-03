// Seed cold-start/resume cards from persisted last-good snapshot, then update via RPC; avoids ~1s empty flash while reconnecting.
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AccountsSnapshot } from '../components/AccountUsage'
// Persist canonical countsProvenAt so rehydrated counts retain freshness evidence.
import type { HostWorktreeInfo } from '../worktree/home-worktree-info'

const STORAGE_KEY = 'orca:home-snapshot:v1'

export type HomeSnapshot = {
  worktreeInfo: Record<string, HostWorktreeInfo>
  accountsByHost: Record<string, AccountsSnapshot>
  savedAt: number
}

let memoryCache: HomeSnapshot | null = null
let revision = 0
let writeTimer: ReturnType<typeof setTimeout> | null = null

export async function loadHomeSnapshot(): Promise<HomeSnapshot | null> {
  if (memoryCache) {
    return memoryCache
  }
  const startedAt = revision
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (startedAt !== revision) {
      return memoryCache
    }
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    if (!isHomeSnapshot(parsed)) {
      return null
    }
    memoryCache = parsed
    return parsed
  } catch {
    return null
  }
}

// Throttle AsyncStorage writes during per-provider streamed snapshot bursts.
export function saveHomeSnapshot(snapshot: HomeSnapshot): void {
  memoryCache = snapshot
  if (writeTimer) {
    clearTimeout(writeTimer)
  }
  writeTimer = setTimeout(() => {
    writeTimer = null
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch(() => {})
  }, 250)
}

export async function clearHostHomeSnapshot(
  hostId: string,
  isCurrent: () => boolean = () => true
): Promise<void> {
  revision += 1
  const raw = memoryCache ? null : await AsyncStorage.getItem(STORAGE_KEY)
  if (!isCurrent()) {
    throw new Error('mobile_session_required')
  }
  let snapshot = memoryCache
  if (!snapshot && raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isHomeSnapshot(parsed)) {
        throw new Error('invalid_snapshot')
      }
      snapshot = parsed
    } catch {
      await AsyncStorage.removeItem(STORAGE_KEY)
      return
    }
  }
  if (!snapshot) {
    return
  }
  if (writeTimer) {
    clearTimeout(writeTimer)
  }
  writeTimer = null
  const worktreeInfo = { ...snapshot.worktreeInfo }
  const accountsByHost = { ...snapshot.accountsByHost }
  delete worktreeInfo[hostId]
  delete accountsByHost[hostId]
  memoryCache = { ...snapshot, worktreeInfo, accountsByHost }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryCache))
}

function isHomeSnapshot(value: unknown): value is HomeSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'worktreeInfo' in value &&
    typeof value.worktreeInfo === 'object' &&
    value.worktreeInfo !== null &&
    'accountsByHost' in value &&
    typeof value.accountsByHost === 'object' &&
    value.accountsByHost !== null &&
    'savedAt' in value &&
    typeof value.savedAt === 'number'
  )
}
