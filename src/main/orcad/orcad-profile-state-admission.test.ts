import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { acquireProfileStateMaintenance } from '../persistence/profile-state/profile-state-access'
import { profileStateAccessPaths } from '../persistence/profile-state/profile-state-access-owner'
import type { OrcadInstanceLock } from './orcad-instance-lock'

const state = vi.hoisted(() => ({
  browserProvider: vi.fn(() => ({ ready: Promise.resolve(), stop: async () => {} }))
}))
vi.mock('./orcad-browser-startup', () => ({ startOrcadBrowserProvider: state.browserProvider }))
// This is the instance-lock unit port; profile admission and maintenance still use real files.
vi.mock('./orcad-instance-lock', () => ({
  acquireOrcadInstanceLock: (dataRoot: string): OrcadInstanceLock => ({
    path: join(dataRoot, 'orcad.lock'),
    record: {
      pid: process.pid,
      startedAtMs: null,
      identity: 'admission-unit-fixture',
      version: 'unit-fixture',
      acquiredAt: new Date(0).toISOString(),
      nonce: 'admission-unit-fixture'
    },
    release() {}
  })
}))

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
  state.browserProvider.mockImplementationOnce(() => {
    throw new Error('browser setup failed')
  })
  const start = vi.fn(async () => ({}))
  const { startOrcadWithHost } = await import('./orcad-lifecycle')
  await expect(startOrcadWithHost(root, start, () => {})).rejects.toThrow('browser setup failed')
  expect(start).not.toHaveBeenCalled()
  expect(readdirSync(profileStateAccessPaths(root).participants)).toEqual([])
  acquireProfileStateMaintenance(root).release()
})
