// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { FEATURE_WALL_SETUP_STEPS } from '../../../../shared/feature-wall-setup-steps'
import type { FeatureWallSetupProgress } from '../feature-wall/feature-wall-setup-progress'
import {
  publishSetupGuideProgressSnapshot,
  resetSetupGuideProgressSnapshotForTests,
  useSetupGuideProgressSnapshot
} from './setup-guide-progress-snapshot'

describe('setup guide progress snapshot', () => {
  beforeEach(() => {
    resetSetupGuideProgressSnapshotForTests()
  })

  it('starts unready and publishes the root observer result to passive consumers', () => {
    const { result } = renderHook(() => useSetupGuideProgressSnapshot())
    expect(result.current).toMatchObject({
      ready: false,
      coreDoneCount: 0,
      coreTotal: FEATURE_WALL_SETUP_STEPS.length
    })

    const progress: FeatureWallSetupProgress = {
      ready: true,
      stepDone: Object.fromEntries(
        FEATURE_WALL_SETUP_STEPS.map((step) => [step.id, step.id === 'default-agent'])
      ) as FeatureWallSetupProgress['stepDone'],
      coreDoneCount: 1,
      coreTotal: FEATURE_WALL_SETUP_STEPS.length
    }
    act(() => publishSetupGuideProgressSnapshot(progress))

    expect(result.current).toBe(progress)
  })
})
