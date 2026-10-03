import { opendir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { runProcess } from '../../shared/child-process/run-process'
import { hiveAgentTextPackManifestSchema } from '../../shared/hive-agent-text-pack'
import {
  resolveHiveAgentTextPack,
  type HiveAgentTextPackSource
} from '../native-chat/hive-agent-text-pack'
import { createManagedPiEnvironment } from './managed-pi-environment'
import { managedPiPackArtifactNames, managedPiPackIndexSchema } from './managed-pi-pack-index'
import { verifyManagedPiPackFile, verifyManagedPiPackRoot } from './managed-pi-pack-files'

const nodeIdentitySchema = z.strictObject({
  node: z.string(),
  platform: z.string(),
  architecture: z.string()
})

/** Internal build trust input, never a caller-supplied or self-read install digest. */
export async function loadManagedPiTextPack(trust: {
  rootDirectory: string
  indexSha256: string
}): Promise<{
  readPack: HiveAgentTextPackSource
  getLaunchFiles: () => Readonly<{ node: string; runner: string }>
  dispose: () => void
}> {
  try {
    const { rootDirectory, indexSha256 } = trust
    if (!isAbsolute(rootDirectory) || !/^[a-f0-9]{64}$/.test(indexSha256)) {
      throw new Error('missing trusted Pack identity')
    }
    const installed = await verifyManagedPiPackRoot(rootDirectory)
    const indexFile = await verifyManagedPiPackFile(installed.root, 'pack-index.json', 64 * 1024)
    if (indexFile.sha256 !== indexSha256) {
      throw new Error('untrusted Pack index')
    }
    const index = managedPiPackIndexSchema.parse(JSON.parse(indexFile.content!))
    const manifest = hiveAgentTextPackManifestSchema.parse({
      ...index.manifest,
      packRevision: indexFile.sha256
    })
    const profile = manifest.profiles[0]
    const protocol = profile?.protocols[0]
    if (!profile || !protocol) {
      throw new Error('Pack has no text profile')
    }
    resolveHiveAgentTextPack(
      () => ({ manifest, assertCurrent: installed.assertCurrent }),
      profile.profileId,
      protocol
    )
    const names = managedPiPackArtifactNames(manifest.platform)
    const expectedNames = new Set(['pack-index.json', ...Object.values(names)])
    for await (const entry of await opendir(installed.root)) {
      if (!entry.isFile() || !expectedNames.delete(entry.name)) {
        throw new Error('unexpected Pack inventory')
      }
    }
    if (expectedNames.size !== 0) {
      throw new Error('missing Pack inventory')
    }
    const guards = [installed.assertCurrent, indexFile.assertCurrent]
    for (const role of Object.keys(names) as (keyof typeof names)[]) {
      const file = await verifyManagedPiPackFile(
        installed.root,
        names[role],
        index.artifacts[role].size,
        index.artifacts[role]
      )
      guards.push(file.assertCurrent)
    }
    let revoked = false
    const assertCurrent = () => {
      try {
        if (revoked) {
          throw new Error('revoked Pack')
        }
        for (const guard of guards) {
          guard()
        }
      } catch {
        revoked = true
        throw new Error('hive_agent_pack_unavailable')
      }
    }
    const launchFiles = Object.freeze({
      node: join(installed.root, names.node),
      runner: join(installed.root, names.runner)
    })
    assertCurrent()
    const probe = await runProcess({
      program: launchFiles.node,
      args: [
        '-p',
        'JSON.stringify({node:process.versions.node,platform:process.platform,architecture:process.arch})'
      ],
      cwd: installed.root,
      env: createManagedPiEnvironment(process.env, installed.root),
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
      terminationBarrier: true
    })
    assertCurrent()
    const actual = nodeIdentitySchema.parse(JSON.parse(probe.stdout))
    if (
      probe.code !== 0 ||
      probe.signal !== null ||
      probe.timedOut ||
      probe.outputTruncated ||
      probe.stderr !== '' ||
      actual.node !== manifest.nodeVersion ||
      actual.platform !== manifest.platform ||
      actual.architecture !== manifest.architecture
    ) {
      throw new Error('invalid bundled Node identity')
    }
    return Object.freeze({
      readPack: () => {
        assertCurrent()
        return { manifest: structuredClone(manifest), assertCurrent }
      },
      getLaunchFiles: () => {
        assertCurrent()
        return launchFiles
      },
      dispose: () => {
        revoked = true
      }
    })
  } catch {
    throw new Error('hive_agent_pack_unavailable')
  }
}
