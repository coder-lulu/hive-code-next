import { dirname } from 'node:path'
import { z } from 'zod'
import { runProcess } from '../../shared/child-process/run-process'
import { hiveAgentTextPackManifestSchema } from '../../shared/hive-agent-text-pack'
import { createManagedPiEnvironment } from './managed-pi-environment'
import type { loadManagedPiTextPack } from './managed-pi-pack-loader'

export type VerifiedManagedPiPack = Awaited<ReturnType<typeof loadManagedPiTextPack>>
const identitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  nodeVersion: z.string(),
  piCoreVersion: z.string(),
  piAiVersion: z.string(),
  platform: z.enum(['win32', 'darwin', 'linux']),
  architecture: z.enum(['x64', 'arm64']),
  toolPolicy: z.literal('empty'),
  protocols: z.tuple([z.literal('CHAT_COMPLETIONS'), z.literal('RESPONSES')])
})

/** Executes only the verified Pack's Node/runner; no prompt, credentials or user project. */
export async function verifyManagedPiRuntimeIdentity(pack: VerifiedManagedPiPack) {
  try {
    const snapshot = pack.readPack()
    if (!snapshot) {
      throw new Error('missing Pack')
    }
    const manifest = hiveAgentTextPackManifestSchema.parse(snapshot.manifest)
    const fingerprint = JSON.stringify(manifest)
    const assertCurrent = () => {
      snapshot.assertCurrent()
      const current = pack.readPack()
      current?.assertCurrent()
      if (
        !current ||
        JSON.stringify(hiveAgentTextPackManifestSchema.parse(current.manifest)) !== fingerprint
      ) {
        throw new Error('stale Pack')
      }
      pack.getLaunchFiles()
    }
    assertCurrent()
    const files = pack.getLaunchFiles()
    const result = await runProcess({
      program: files.node,
      args: [
        '-e',
        'process.stdout.write(JSON.stringify(require(process.argv[1]).getManagedPiRuntimeIdentity()))',
        files.runner
      ],
      cwd: dirname(files.runner),
      env: createManagedPiEnvironment(process.env, dirname(files.runner)),
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      terminationBarrier: true
    })
    assertCurrent()
    if (
      result.code !== 0 ||
      result.signal !== null ||
      result.timedOut ||
      result.outputTruncated ||
      result.stderr !== ''
    ) {
      throw new Error('identity probe failed')
    }
    const identity = identitySchema.parse(JSON.parse(result.stdout))
    if (
      identity.nodeVersion !== manifest.nodeVersion ||
      identity.piCoreVersion !== manifest.piCoreVersion ||
      identity.piAiVersion !== manifest.piAiVersion ||
      identity.platform !== manifest.platform ||
      identity.architecture !== manifest.architecture
    ) {
      throw new Error('runtime identity mismatch')
    }
    Object.freeze(identity.protocols)
    return Object.freeze({ identity: Object.freeze(identity), assertCurrent })
  } catch {
    throw new Error('hive_agent_pack_unavailable')
  }
}
