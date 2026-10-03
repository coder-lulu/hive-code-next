import { describe, expect, it } from 'vitest'
import {
  hiveAgentTextExecutionBindingSchema,
  hiveAgentTextPackManifestSchema
} from './hive-agent-text-pack'

const profile = {
  profileId: 'personal',
  protocols: ['CHAT_COMPLETIONS'],
  toolPolicy: 'empty',
  maxInputTokens: 16_000,
  maxOutputTokens: 2_000
}
const manifest = {
  schemaVersion: 1,
  packRevision: 'b'.repeat(64),
  nodeVersion: '1.2.3',
  piCoreVersion: '1.2.3',
  piAiVersion: '1.2.3',
  sourceCommit: 'a'.repeat(40),
  platform: 'win32',
  architecture: 'x64',
  capabilities: ['local.text'],
  protocols: ['CHAT_COMPLETIONS'],
  profiles: [profile]
}
const binding = {
  schemaVersion: 1,
  packRevision: manifest.packRevision,
  profileId: profile.profileId,
  protocol: 'CHAT_COMPLETIONS',
  toolPolicy: 'empty',
  maxInputTokens: profile.maxInputTokens,
  maxOutputTokens: profile.maxOutputTokens
}

describe('strict text Pack declarations and execution metadata', () => {
  it('round-trips declarations and the smaller durable binding', () => {
    expect(hiveAgentTextPackManifestSchema.parse(JSON.parse(JSON.stringify(manifest)))).toEqual(
      manifest
    )
    expect(hiveAgentTextExecutionBindingSchema.parse(JSON.parse(JSON.stringify(binding)))).toEqual(
      binding
    )
  })
  it.each([
    { packRevision: 'b'.repeat(65) },
    { sourceCommit: 'a'.repeat(39) },
    { nodeVersion: '^24.18.0' },
    { protocols: ['CHAT_COMPLETIONS', 'CHAT_COMPLETIONS'] },
    { capabilities: ['local.text', 'local.text'] },
    { profiles: [profile, profile] },
    { profiles: Array.from({ length: 9 }, (_, i) => ({ ...profile, profileId: `profile-${i}` })) },
    { profiles: [{ ...profile, profileId: '../personal' }] },
    { profiles: [{ ...profile, toolPolicy: 'coding' }] },
    { profiles: [{ ...profile, maxInputTokens: 0 }] },
    { profiles: [{ ...profile, maxOutputTokens: 1.5 }] },
    { profiles: [{ ...profile, maxOutputTokens: 1_000_001 }] },
    { profiles: [{ ...profile, apiKey: 'private-credential' }] }
  ])('rejects malformed, duplicate, oversized or privileged declarations %#', (patch) => {
    expect(hiveAgentTextPackManifestSchema.safeParse({ ...manifest, ...patch }).success).toBe(false)
  })
  it.each([
    { maxInputTokens: 16_001 },
    { maxOutputTokens: 2_001 },
    { maxOutputTokens: Number.MAX_SAFE_INTEGER + 1 },
    { protocol: 'IMAGE' },
    { toolPolicy: 'shell' },
    { apiKey: 'private-credential' },
    { manifest },
    { processId: 123 }
  ])('rejects widened ceilings or extra runtime/credential authority %#', (patch) => {
    expect(hiveAgentTextExecutionBindingSchema.safeParse({ ...binding, ...patch }).success).toBe(
      false
    )
  })
})
