import { useSyncExternalStore } from 'react'
import { FEATURE_WALL_SETUP_STEPS } from '../../../../shared/feature-wall-setup-steps'
import type { FeatureWallSetupProgress } from '../feature-wall/feature-wall-setup-progress'

const EMPTY_SETUP_GUIDE_PROGRESS: FeatureWallSetupProgress = Object.freeze({
  ready: false,
  stepDone: Object.freeze({}) as FeatureWallSetupProgress['stepDone'],
  coreDoneCount: 0,
  coreTotal: FEATURE_WALL_SETUP_STEPS.length
})

let setupGuideProgressSnapshot = EMPTY_SETUP_GUIDE_PROGRESS
const listeners = new Set<() => void>()

export function readSetupGuideProgressSnapshot(): FeatureWallSetupProgress {
  return setupGuideProgressSnapshot
}

export function subscribeSetupGuideProgressSnapshot(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishSetupGuideProgressSnapshot(progress: FeatureWallSetupProgress): void {
  if (setupGuideProgressSnapshot === progress) {
    return
  }
  setupGuideProgressSnapshot = progress
  for (const listener of listeners) {
    listener()
  }
}

export function useSetupGuideProgressSnapshot(): FeatureWallSetupProgress {
  return useSyncExternalStore(
    subscribeSetupGuideProgressSnapshot,
    readSetupGuideProgressSnapshot,
    readSetupGuideProgressSnapshot
  )
}

export function resetSetupGuideProgressSnapshotForTests(): void {
  setupGuideProgressSnapshot = EMPTY_SETUP_GUIDE_PROGRESS
  for (const listener of listeners) {
    listener()
  }
}
