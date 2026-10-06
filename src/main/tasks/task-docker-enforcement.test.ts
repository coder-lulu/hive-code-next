import { describe, expect, it } from 'vitest'
import { createTaskDockerBoundary } from './task-docker-boundary'
import { dockerArgs, taskDockerFixture } from './task-docker-boundary.test-fixture'
import { probeTaskDockerEnforcement } from './task-docker-enforcement'

async function fixture() {
  const h = await taskDockerFixture()
  let configuration = {
    dockerPath: h.options.dockerPath,
    endpoint: h.options.endpoint,
    imageId: h.options.imageId
  }
  const owner = {
    runtimeRecordId: h.options.record.command.runtimeRecordId,
    ownershipEpoch: h.options.record.command.ownershipEpoch,
    executionAccountRef: 'account:original'
  }
  const probe = () =>
    probeTaskDockerEnforcement({
      configuration: () => configuration,
      owner,
      assertCurrent: h.options.assertCurrent,
      run: h.run
    })
  return {
    ...h,
    owner,
    probe,
    replaceConfiguration: () => {
      configuration = { ...configuration, imageId: `sha256:${'d'.repeat(64)}` }
    }
  }
}

describe('host-issued Docker enforcement evidence', () => {
  it('derives stable evidence only after bounded read-only daemon and image inspection', async () => {
    const h = await fixture()
    const proof = await h.probe()
    expect(proof.policy.trustMode).toBe('enforced_autonomous')
    expect(proof.policy.enforcementEvidenceRef).toMatch(/^docker-enforcement:[a-f0-9]{64}$/)
    expect(h.run.mock.calls.map(([spec]) => dockerArgs(spec)[0])).toEqual(['info', 'image', 'info'])
    expect(
      h.run.mock.calls.every(([spec]) => spec.timeoutMs === 15000 && spec.maxOutputBytes === 262144)
    ).toBe(true)
    expect((await h.probe()).policy).toEqual(proof.policy)
    expect(() => proof.assertCurrent()).not.toThrow()
  })

  it('rejects a remote endpoint before invoking Docker', async () => {
    const h = await fixture()
    await expect(
      probeTaskDockerEnforcement({
        configuration: () => ({ ...h.options, endpoint: 'tcp://remote:2375' }),
        owner: h.owner,
        assertCurrent: h.options.assertCurrent,
        run: h.run
      })
    ).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    expect(h.run).not.toHaveBeenCalled()
  })

  it('rejects daemon substitution during the image inspection', async () => {
    const h = await fixture()
    h.before((spec) => {
      if (dockerArgs(spec)[0] === 'image') {
        h.daemon.ID = 'daemon:replacement'
      }
    })
    await expect(h.probe()).rejects.toThrow('CAPABILITY_UNAVAILABLE')
  })

  it('rejects an unsafe image and unavailable daemon instead of creating proof', async () => {
    const h = await fixture()
    h.image.Config.Env.push('DOCKER_HOST=tcp://remote')
    await expect(h.probe()).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    h.image.Config.Env.pop()
    h.run.mockRejectedValueOnce(new Error('daemon unavailable'))
    await expect(h.probe()).rejects.toThrow('CAPABILITY_UNAVAILABLE')
  })

  it('fences a proof when installed configuration or original owner changes', async () => {
    const h = await fixture()
    const proof = await h.probe()
    h.replaceConfiguration()
    expect(() => proof.assertCurrent()).toThrow('FORBIDDEN')
    const fresh = await fixture()
    const ownerProof = await fresh.probe()
    fresh.revoke()
    expect(() => ownerProof.assertCurrent()).toThrow('revoked')
  })

  it('requires the original launch boundary to see the same daemon before creating a container', async () => {
    const h = await fixture()
    const proof = await h.probe()
    h.daemon.ID = 'daemon:replacement'
    const boundary = createTaskDockerBoundary({ ...h.options, expectedDaemon: proof.daemon })
    await expect(boundary.prepare()).rejects.toThrow('FORBIDDEN')
    expect(h.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'create')).toBe(false)
  })
})
