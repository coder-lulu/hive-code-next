import productPackage from '../../../package.json'
import runtimePackage from '../../../runtime/managed-pi/package.json'
import {
  hiveAgentTextPackManifestSchema,
  type HiveAgentTextPackManifest
} from '../../shared/hive-agent-text-pack'

/** Explicit test-only declaration; never represents an installed production Pack. */
export function textPackManifestFixture(): HiveAgentTextPackManifest {
  return hiveAgentTextPackManifestSchema.parse({
    schemaVersion: 1,
    packRevision: 'b'.repeat(64),
    nodeVersion: productPackage.engines.node,
    piCoreVersion: runtimePackage.dependencies['@earendil-works/pi-agent-core'],
    piAiVersion: runtimePackage.dependencies['@earendil-works/pi-ai'],
    sourceCommit: runtimePackage.hiveSource.commit,
    platform: process.platform,
    architecture: process.arch,
    capabilities: ['local.text'],
    protocols: ['CHAT_COMPLETIONS', 'RESPONSES'],
    profiles: [
      {
        profileId: 'personal',
        protocols: ['CHAT_COMPLETIONS', 'RESPONSES'],
        toolPolicy: 'empty',
        maxInputTokens: 32_000,
        maxOutputTokens: 4_000
      }
    ]
  })
}
