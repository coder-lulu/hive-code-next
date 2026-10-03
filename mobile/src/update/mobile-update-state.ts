import type { MobileUpdateArtifact } from './mobile-update-contract'
export type MobileUpdateSnapshot = {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'awaiting-permission'
    | 'opening-installer'
    | 'ready-to-install'
    | 'not-available'
    | 'error'
  version: string | null
  buildNumber: number | null
  mandatory: boolean
  minimumSupportedBuild: number | null
  message: string | null
  artifact: MobileUpdateArtifact | null
  promptVisible: boolean
  downloadedBytes: number
  totalBytes: number
}

export const INITIAL_SNAPSHOT: MobileUpdateSnapshot = {
  state: 'idle',
  version: null,
  buildNumber: null,
  mandatory: false,
  minimumSupportedBuild: null,
  message: null,
  artifact: null,
  promptVisible: false,
  downloadedBytes: 0,
  totalBytes: 0
}

export let snapshot = INITIAL_SNAPSHOT
const listeners = new Set<() => void>()
export const updateOperations: {
  check: Promise<MobileUpdateSnapshot> | null
  install: Promise<MobileUpdateSnapshot> | null
} = { check: null, install: null }

export function dismissMobileUpdatePrompt(): void {
  if (!snapshot.mandatory) {
    publish({ ...snapshot, promptVisible: false })
  }
}

export function showMobileUpdatePrompt(): void {
  if (snapshot.artifact) {
    publish({ ...snapshot, promptVisible: true })
  }
}

export function publish(next: MobileUpdateSnapshot): MobileUpdateSnapshot {
  snapshot = next
  listeners.forEach((listener) => listener())
  return next
}

export function getMobileUpdateSnapshot(): MobileUpdateSnapshot {
  return snapshot
}

export function subscribeMobileUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
