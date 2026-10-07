import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { runProcess } from '../../shared/child-process/run-process'
import { taskDockerFixture } from './task-docker-boundary.test-fixture'
import { createLocalTaskDockerEnforcement } from './task-docker-enforcement-runtime'
import { taskCommand } from './task-execution.test-fixture'

const ports = vi.hoisted(() => ({ run: vi.fn<typeof runProcess>() }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: ports.run }))

async function fixture() {
  const docker = await taskDockerFixture()
  ports.run.mockImplementation(docker.run)
  let owner = { runtimeRecordId: 'runtime:one', ownershipEpoch: 1, accountId: 'account' }
  const account = {
    accountId: 'account',
    authorityId: 'authority',
    sessionGeneration: 1,
    accessToken: 'fixture',
    sessionExpiresAt: Date.now() + 120_000
  }
  const enforcement = createLocalTaskDockerEnforcement({
    userDataPath: docker.root,
    currentRuntime: () => owner,
    account: { getRuntimeCloudAuthorization: () => account },
    assertCurrent: () => undefined
  })
  const install = async () => {
    await mkdir(join(docker.root, 'hive-tasks'))
    await writeFile(
      join(docker.root, 'hive-tasks', 'docker-runtime.json'),
      JSON.stringify({
        dockerPath: docker.options.dockerPath,
        endpoint: docker.options.endpoint,
        imageId: docker.options.imageId
      }),
      { mode: 0o600 }
    )
  }
  return {
    docker,
    enforcement,
    install,
    renew: () => {
      owner = { ...owner, ownershipEpoch: 2 }
    }
  }
}

describe('local Runtime enforcement capability proof', () => {
  it('advertises no enforcement from configuration alone and retains successful proof for reads', async () => {
    const h = await fixture()
    expect(h.enforcement.capabilities()).toEqual([])
    await expect(h.enforcement.current()).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    await h.install()
    expect(h.enforcement.capabilities()).toEqual([])
    const proof = await h.enforcement.current()
    expect(h.enforcement.capabilities()).toEqual(['task.enforcement.v1'])
    expect(await h.enforcement.current()).toBe(proof)
    expect(h.docker.run).toHaveBeenCalledTimes(3)
    h.renew()
    expect(h.enforcement.capabilities()).toEqual([])
    expect(() => proof.assertCurrent()).toThrow('FORBIDDEN')
  })

  it('freshly checks actual Docker at start and withdraws stale capability on failure', async () => {
    const h = await fixture()
    await h.install()
    const proof = await h.enforcement.current()
    const command = taskCommand({
      runtimeRecordId: proof.owner.runtimeRecordId,
      ownershipEpoch: proof.owner.ownershipEpoch,
      executionAccountRef: proof.owner.executionAccountRef,
      policyRevision: 'docker-local-linux:1',
      executionPolicy: proof.policy
    })
    h.docker.run.mockRejectedValueOnce(new Error('daemon unavailable'))
    await expect(h.enforcement.authorize(command, 'start')).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(h.enforcement.capabilities()).toEqual([])
    await expect(h.enforcement.authorize(command, 'cancel')).resolves.toBeUndefined()
  })
})
