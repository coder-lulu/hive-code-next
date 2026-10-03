import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readHiveGoldenDomain } from './hive-golden-domain'

describe('Hive golden domains', () => {
  it('treats a recorder scratch directory without a manifest as self-contained', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hive-golden-domain-'))
    try {
      await writeFile(join(directory, 'second.json'), '{}\n')
      await writeFile(join(directory, 'first.json'), '{}\n')

      expect(readHiveGoldenDomain(directory)).toEqual({
        kind: 'standalone',
        upstreamIds: ['first', 'second'],
        supportedIds: ['first', 'second'],
        unsupportedIds: []
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
