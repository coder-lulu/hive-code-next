import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probeTaskDockerEnforcement } from '../../src/main/tasks/task-docker-enforcement.ts'

describe.skipIf(process.env.HIVE_CASE_DOCKER_LIVE !== '1')(
  'actual selected local Linux Docker enforcement availability',
  () => {
    it('observes the real daemon and pinned worker image without creating a container or model request', async () => {
      const configuration = {
        dockerPath: 'C:/Program Files/Docker/Docker/resources/bin/docker.exe',
        endpoint: 'npipe:////./pipe/dockerDesktopLinuxEngine',
        imageId: 'sha256:95c8d973e5f3e575bda63abf79ccf20ca9884014692839c190361601e39b32d3'
      }
      const owner = {
        runtimeRecordId: 'validation:docker-case-preflight',
        ownershipEpoch: 1,
        executionAccountRef: 'account:synthetic-docker-validation'
      }
      const proof = await probeTaskDockerEnforcement({
        configuration: () => configuration,
        owner,
        assertCurrent() {}
      })
      expect(proof.policy.trustMode).toBe('enforced_autonomous')
      expect(proof.daemon.OSType).toBe('linux')
      expect(() => proof.assertCurrent()).not.toThrow()
      const directory = resolve(
        'logs/paperclip-development/p3/case-execution/verification/live-docker'
      )
      await mkdir(directory, { recursive: true })
      await writeFile(
        resolve(directory, 'evidence.json'),
        JSON.stringify(
          {
            actualDockerInspection: true,
            actualCloudOwnership: false,
            syntheticOwner: true,
            modelExecution: false,
            containerCreated: false,
            configuration,
            daemon: proof.daemon,
            policy: proof.policy,
            capturedAt: new Date().toISOString()
          },
          null,
          2
        )
      )
    }, 60_000)
  }
)
