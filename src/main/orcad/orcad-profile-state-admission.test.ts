import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { acquireProfileStateMaintenance } from '../persistence/profile-state/profile-state-access'
import { profileStateAccessPaths } from '../persistence/profile-state/profile-state-access-owner'

const state = vi.hoisted(() => ({ browserProvider: vi.fn(async () => null) }))
vi.mock('./orcad-browser-provider', () => ({ resolveOrcadBrowserProvider: state.browserProvider }))
vi.mock('./orcad-instance-lock', () => ({ acquireOrcadInstanceLock: () => ({ release() {} }) }))

const roots: string[] = []
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hive-headless-admission-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
  vi.clearAllMocks()
})

it('refuses recovery overlap before initializing the browser provider or runtime', async () => {
  const root = temporaryRoot()
  const maintenance = acquireProfileStateMaintenance(root)
  const start = vi.fn(async () => ({}))
  const { startOrcadWithHost } = await import('./orcad-lifecycle')
  try {
    await expect(startOrcadWithHost(root, start, () => {})).rejects.toThrow()
    expect(state.browserProvider).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  } finally {
    maintenance.release()
  }
})

it('keeps admission until runtime teardown finishes', async () => {
  const root = temporaryRoot()
  const { startOrcadWithHost } = await import('./orcad-lifecycle')
  let finishTeardown: (() => void) | undefined
  const teardown = new Promise<void>((resolve) => {
    finishTeardown = resolve
  })
  const host = await startOrcadWithHost(
    root,
    async (registerCleanup) => {
      registerCleanup(() => teardown)
      return {}
    },
    () => {}
  )
  const stopped = host.stop()
  expect(() => acquireProfileStateMaintenance(root)).toThrow()
  finishTeardown!()
  await stopped
  expect(readdirSync(profileStateAccessPaths(root).participants)).toEqual([])
  acquireProfileStateMaintenance(root).release()
})

it('releases admission when host setup fails before a runtime exists', async () => {
  const root = temporaryRoot()
  state.browserProvider.mockRejectedValueOnce(new Error('browser setup failed'))
  const { startOrcadWithHost } = await import('./orcad-lifecycle')
  await expect(startOrcadWithHost(root, async () => ({}), () => {})).rejects.toThrow(
    'browser setup failed'
  )
  expect(readdirSync(profileStateAccessPaths(root).participants)).toEqual([])
  acquireProfileStateMaintenance(root).release()
})
