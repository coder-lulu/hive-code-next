import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import type { SpawnedSourceControlAgentProcess } from './source-control-text-generation-types'

const mocks = vi.hoisted(() => ({ status: vi.fn(), userData: '/dev/hive-profile' }))
vi.mock('../cli/cli-installer', () => ({
  CliInstaller: class {
    getStatus() {
      return mocks.status()
    }
  }
}))
vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => mocks.userData })
}))
import { discoverModelsLocal } from './commit-message-model-discovery'

beforeEach(() =>
  mocks.status.mockResolvedValue({ launcherPath: '/dev/hive-profile/cli/bin/orca-dev.cmd' })
)

it('uses this app launcher and profile without relying on PATH or an agent override', async () => {
  const spawnAgent = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn()
    })
    queueMicrotask(() => {
      child.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            models: [{ selector: 'hivecode/model', id: 'model', provider: 'hivecode' }]
          })
        )
      )
      child.emit('close', 0)
    })
    return child as unknown as SpawnedSourceControlAgentProcess
  })
  const result = await discoverModelsLocal({
    agentId: 'hivecode',
    env: { ORCA_USER_DATA_PATH: '/wrong', PATH: '/other' },
    agentCommandOverride: 'wrong hive-ai',
    options: {},
    backslash: 'escape',
    spawnAgent
  })
  expect(result.success).toBe(true)
  expect(spawnAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      binary: '/dev/hive-profile/cli/bin/orca-dev.cmd',
      args: ['hive-ai', '--list-models'],
      env: expect.objectContaining({ ORCA_USER_DATA_PATH: '/dev/hive-profile', PATH: '/other' })
    })
  )
})

it('refuses unsupported WSL discovery and a missing app launcher without spawning', async () => {
  const spawnAgent = vi.fn()
  const input = {
    agentId: 'hivecode' as const,
    env: undefined,
    options: { wslDistro: 'Ubuntu' },
    backslash: 'escape' as const,
    spawnAgent
  }
  expect((await discoverModelsLocal(input)).success).toBe(false)
  mocks.status.mockResolvedValue({ launcherPath: null })
  expect((await discoverModelsLocal({ ...input, options: {} })).success).toBe(false)
  expect(spawnAgent).not.toHaveBeenCalled()
})
