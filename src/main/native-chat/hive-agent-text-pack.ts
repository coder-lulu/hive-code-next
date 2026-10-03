import productPackage from '../../../package.json'
import runtimePackage from '../../../runtime/managed-pi/package.json'
import {
  hiveAgentTextExecutionBindingSchema,
  hiveAgentTextPackManifestSchema,
  type HiveAgentTextExecutionBinding
} from '../../shared/hive-agent-text-pack'
import type { HiveAiProtocol } from '../../shared/hive-ai-model-catalog'

/** Main-process trusted loader port; absence never enables an unverified runtime. */
export type HiveAgentTextPackSource = () => {
  manifest: unknown
  assertCurrent: () => void
} | null

export function resolveHiveAgentTextPack(
  readPack: HiveAgentTextPackSource | undefined,
  profileId: string,
  protocol: HiveAiProtocol
): { binding: Readonly<HiveAgentTextExecutionBinding>; assertCurrent: () => void } {
  try {
    const snapshot = readPack?.()
    if (!snapshot) {
      throw new Error('missing Pack')
    }
    const assertSnapshotCurrent = snapshot.assertCurrent.bind(snapshot)
    assertSnapshotCurrent()
    const manifest = hiveAgentTextPackManifestSchema.parse(snapshot.manifest)
    const profile = manifest.profiles.find((item) => item.profileId === profileId)
    if (
      manifest.nodeVersion !== productPackage.engines.node ||
      manifest.piCoreVersion !== runtimePackage.dependencies['@earendil-works/pi-agent-core'] ||
      manifest.piAiVersion !== runtimePackage.dependencies['@earendil-works/pi-ai'] ||
      manifest.sourceCommit !== runtimePackage.hiveSource.commit ||
      manifest.platform !== process.platform ||
      manifest.architecture !== process.arch ||
      !manifest.capabilities.includes('local.text') ||
      !manifest.protocols.includes(protocol) ||
      !profile?.protocols.includes(protocol)
    ) {
      throw new Error('incompatible Pack')
    }
    const binding = Object.freeze(
      hiveAgentTextExecutionBindingSchema.parse({
        schemaVersion: 1,
        packRevision: manifest.packRevision,
        profileId,
        protocol,
        toolPolicy: profile.toolPolicy,
        maxInputTokens: Math.min(profile.maxInputTokens, 16_000),
        maxOutputTokens: Math.min(profile.maxOutputTokens, 2_000)
      })
    )
    const fingerprint = JSON.stringify(manifest)
    const assertCurrent = () => {
      try {
        assertSnapshotCurrent()
        const current = readPack?.()
        if (!current) {
          throw new Error('missing Pack')
        }
        current.assertCurrent()
        if (
          JSON.stringify(hiveAgentTextPackManifestSchema.parse(current.manifest)) !== fingerprint
        ) {
          throw new Error('stale Pack')
        }
      } catch {
        throw new Error('hive_agent_pack_unavailable')
      }
    }
    assertCurrent()
    return { binding, assertCurrent }
  } catch {
    throw new Error('hive_agent_pack_unavailable')
  }
}
