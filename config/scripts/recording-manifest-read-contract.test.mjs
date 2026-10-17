import { describe, expect, it } from 'vitest'
import { decodeRecordingManifest } from './upstream-recording-source.mjs'

function historicalManifest() {
  return {
    version: 2,
    baseline: 'a'.repeat(40),
    upstreamBaseline: 'b'.repeat(40),
    upstreamGoldensSha256: 'c'.repeat(64),
    recorderSha256: 'd'.repeat(64),
    scenariosSha256: 'e'.repeat(64),
    adapterSha256ByOperation: { 'settings.get': 'f'.repeat(64) },
    overlays: {}
  }
}

describe('recording manifest read contract', () => {
  it.each([undefined, null, {}])('rejects absent provenance: %j', (manifest) => {
    expect(() => decodeRecordingManifest(manifest)).toThrow()
  })

  it('reads a complete historical v2 manifest without rewriting its provenance', () => {
    const manifest = historicalManifest()
    Object.freeze(manifest.adapterSha256ByOperation)
    Object.freeze(manifest.overlays)
    Object.freeze(manifest)
    const before = JSON.stringify(manifest)

    expect(decodeRecordingManifest(manifest)).toBe(manifest)
    expect(JSON.stringify(manifest)).toBe(before)
    expect(manifest).not.toHaveProperty('source')
  })

  it.each(['baseline', 'upstreamBaseline'])(
    'rejects a malformed or missing historical %s',
    (field) => {
      const manifest = historicalManifest()
      expect(() => decodeRecordingManifest({ ...manifest, [field]: 'malformed' })).toThrow(
        'Invalid historical v2 source'
      )
      Reflect.deleteProperty(manifest, field)
      expect(() => decodeRecordingManifest(manifest)).toThrow()
    }
  )

  it('rejects mixed historical and current source identities', () => {
    expect(() =>
      decodeRecordingManifest({ ...historicalManifest(), source: { kind: 'tree-sync-content' } })
    ).toThrow()
  })
})
