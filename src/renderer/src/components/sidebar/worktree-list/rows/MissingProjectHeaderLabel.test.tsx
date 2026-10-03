import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type * as ReactI18next from 'react-i18next'
import type { AppState } from '@/store/types'
import { makeWorktree } from '@/store/slices/store-test-helpers'
import { MissingProjectHeaderLabel } from './MissingProjectHeaderLabel'

const state = vi.hoisted((): Pick<AppState, 'worktreesByRepo' | 'repoCatalogStatusByHost'> => ({
  worktreesByRepo: {},
  repoCatalogStatusByHost: {}
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (value: typeof state) => unknown) => selector(state)
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback })
}))

describe('missing project label', () => {
  it.each([
    ['loading', 'Syncing projects…'],
    ['unavailable', 'Project catalog unavailable'],
    ['ready', 'Project information unavailable']
  ] as const)('shows the actual catalog state: %s', (status, label) => {
    state.worktreesByRepo = {
      repo: [
        makeWorktree({
          id: 'repo::/path',
          repoId: 'repo',
          hostId: 'local',
          runtimeOwnerEnvironmentId: 'peer'
        })
      ]
    }
    state.repoCatalogStatusByHost = { 'runtime:peer': status }
    expect(renderToStaticMarkup(<MissingProjectHeaderLabel repoId="repo" />)).toBe(label)
  })
})
