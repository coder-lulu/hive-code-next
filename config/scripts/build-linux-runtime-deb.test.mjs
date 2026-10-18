import { afterEach, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn(() => ({ status: 0 })) }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.resetModules()
})

it.each(['x64', 'arm64'])(
  'pins reserved revision and native architecture for %s Runtime deb',
  async (arch) => {
    const exit = vi.fn()
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
      arch,
      env: { ...process.env, HIVECODE_BUILD_NUMBER: '42', BUILD_NUMBER: '999' },
      argv: ['node', 'build-linux-runtime-deb.mjs'],
      exit
    })
    await import('./build-linux-runtime-deb.mjs')
    expect(spawnSync).toHaveBeenCalledWith(
      'pnpm',
      [
        'exec',
        'electron-builder',
        '--config',
        'config/electron-builder.config.cjs',
        '--linux',
        'deb',
        `--${arch}`,
        '--publish',
        'never',
        '--config.buildNumber=42'
      ],
      expect.objectContaining({
        env: expect.objectContaining({
          HIVECODE_HEADLESS_RUNTIME_DEB: '1',
          ORCA_LINUX_ARM64_RELEASE: arch === 'arm64' ? '1' : '0'
        }),
        shell: false
      })
    )
    expect(exit).toHaveBeenCalledWith(0)
  }
)

it.each(['', '0', '-1', '3garbage', '9007199254740992'])(
  'rejects invalid reserved revision %s before packaging',
  async (buildNumber) => {
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
      arch: 'x64',
      env: { ...process.env, HIVECODE_BUILD_NUMBER: buildNumber },
      argv: ['node', 'build-linux-runtime-deb.mjs'],
      exit: vi.fn()
    })
    await expect(import('./build-linux-runtime-deb.mjs')).rejects.toThrow('positive integer')
    expect(spawnSync).not.toHaveBeenCalled()
  }
)
