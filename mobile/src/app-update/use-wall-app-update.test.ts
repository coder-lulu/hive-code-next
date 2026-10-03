import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INITIAL_SNAPSHOT } from '../update/mobile-update-state'
import { useWallAppUpdate } from './use-wall-app-update'
import { useWallAppUpdate as usePageWallAppUpdate } from './use-wall-app-update.web'

const runtime = vi.hoisted(() => ({ snapshot: {}, install: vi.fn() }))
vi.mock('../update/use-mobile-update', () => ({ useMobileUpdate: () => runtime }))

beforeEach(() => {
  runtime.snapshot = { ...INITIAL_SNAPSHOT }
  runtime.install.mockClear()
})

describe('useWallAppUpdate', () => {
  it('offers a dismissed Hive update through the verified native install owner', () => {
    runtime.snapshot = {
      ...INITIAL_SNAPSHOT,
      state: 'available',
      version: '1.5.0-beta.24',
      artifact: { downloadUrl: 'https://hive.test/artifact' },
      promptVisible: false
    }
    const release = useWallAppUpdate()
    expect(release).toMatchObject({ version: '1.5.0-beta.24', pending: false })
    release?.install()
    expect(runtime.install).toHaveBeenCalledOnce()
  })

  it('offers nothing without a known product artifact', () => {
    expect(useWallAppUpdate()).toBeNull()
    runtime.snapshot = { ...INITIAL_SNAPSHOT, version: '1.5.0-beta.24' }
    expect(useWallAppUpdate()).toBeNull()
  })

  it('reports installation progress without starting another check', () => {
    runtime.snapshot = {
      ...INITIAL_SNAPSHOT,
      state: 'downloading',
      version: '1.5.0-beta.24',
      artifact: {},
      message: '正在下载'
    }
    expect(useWallAppUpdate()).toMatchObject({ pending: true, message: '正在下载' })
    expect(runtime.install).not.toHaveBeenCalled()
  })

  it('leaves the page package update action to the app', () => {
    expect(usePageWallAppUpdate()).toBeNull()
  })
})
