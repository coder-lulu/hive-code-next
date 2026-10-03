import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureWallSetupProgress } from '../feature-wall/feature-wall-setup-progress'
import { useSettingsSetupGuideProgress } from './settings-setup-guide-progress'

const mocks = vi.hoisted(() => ({
  useSetupGuideProgress: vi.fn(),
  useSetupGuideProgressSnapshot: vi.fn()
}))

vi.mock('../setup-guide/use-setup-guide-progress', () => ({
  useSetupGuideProgress: mocks.useSetupGuideProgress
}))

vi.mock('../setup-guide/setup-guide-progress-snapshot', () => ({
  useSetupGuideProgressSnapshot: mocks.useSetupGuideProgressSnapshot
}))

function makeProgress(): FeatureWallSetupProgress {
  return {
    ready: true,
    stepDone: {
      'default-agent': true,
      'add-two-repos': false,
      notifications: true,
      'two-worktrees': true,
      browser: false,
      'task-sources': true,
      'agent-capabilities': false,
      'setup-script': false
    },
    coreDoneCount: 4,
    coreTotal: 8
  }
}

function SettingsProgressProbe(): React.JSX.Element {
  const progress = useSettingsSetupGuideProgress()
  return <span>{`${progress.doneCount}/${progress.total}`}</span>
}

describe('useSettingsSetupGuideProgress', () => {
  beforeEach(() => {
    mocks.useSetupGuideProgress.mockReset()
    mocks.useSetupGuideProgressSnapshot.mockReset()
  })

  it('reads the root observer snapshot without starting another setup-guide refresh', () => {
    mocks.useSetupGuideProgressSnapshot.mockReturnValue(makeProgress())

    expect(renderToStaticMarkup(<SettingsProgressProbe />)).toContain('4/8')
    expect(mocks.useSetupGuideProgressSnapshot).toHaveBeenCalledOnce()
    expect(mocks.useSetupGuideProgress).not.toHaveBeenCalled()
  })

  it('uses legacy-aware completion returned by the shared setup progress path', () => {
    mocks.useSetupGuideProgressSnapshot.mockReturnValue({
      ...makeProgress(),
      stepDone: {
        'default-agent': true,
        'add-two-repos': true,
        notifications: true,
        'two-worktrees': true,
        browser: true,
        'task-sources': true,
        'agent-capabilities': true,
        'setup-script': true
      },
      coreDoneCount: 8
    })

    expect(renderToStaticMarkup(<SettingsProgressProbe />)).toContain('8/8')
  })

  it('shows browser incomplete after the browser migration has already run for fresh users', () => {
    mocks.useSetupGuideProgressSnapshot.mockReturnValue({
      ...makeProgress(),
      stepDone: {
        'default-agent': true,
        'add-two-repos': true,
        notifications: true,
        'two-worktrees': true,
        browser: false,
        'task-sources': true,
        'agent-capabilities': true,
        'setup-script': true
      },
      coreDoneCount: 7
    })

    expect(renderToStaticMarkup(<SettingsProgressProbe />)).toContain('7/8')
  })
})
