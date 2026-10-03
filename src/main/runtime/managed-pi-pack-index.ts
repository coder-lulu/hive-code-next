import { z } from 'zod'
import { hiveAgentTextPackManifestSchema } from '../../shared/hive-agent-text-pack'

const artifact = (maximumBytes: number) =>
  z.strictObject({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive().max(maximumBytes)
  })

/** Build-owned digest covers this index and the exact standalone artifact set. */
export const managedPiPackIndexSchema = z.strictObject({
  schemaVersion: z.literal(1),
  manifest: hiveAgentTextPackManifestSchema.omit({ packRevision: true }),
  artifacts: z.strictObject({
    node: artifact(128 * 1024 * 1024),
    runner: artifact(32 * 1024 * 1024),
    package: artifact(128 * 1024),
    lock: artifact(2 * 1024 * 1024),
    sbom: artifact(4 * 1024 * 1024),
    license: artifact(4 * 1024 * 1024),
    notice: artifact(4 * 1024 * 1024)
  })
})

export type ManagedPiPackIndex = z.infer<typeof managedPiPackIndexSchema>

export function managedPiPackArtifactNames(platform: ManagedPiPackIndex['manifest']['platform']) {
  return {
    node: platform === 'win32' ? 'node.exe' : 'node',
    runner: 'agent.cjs',
    package: 'package.json',
    lock: 'pnpm-lock.yaml',
    sbom: 'sbom.json',
    license: 'LICENSE',
    notice: 'NOTICE'
  } as const
}
