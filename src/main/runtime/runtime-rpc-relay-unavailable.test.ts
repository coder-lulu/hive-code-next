import './rpc/unused-default-rpc-methods.test-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

// Hive account transport is installed separately; an old automatic QR request must not mint LAN credentials.
describe('retired provider mobile pairing boundary', () => {
  it.each([undefined, '192.0.2.1'])(
    'refuses automatic pairing before generating a credential (%s)',
    async (address) => {
      const userDataPath = mkdtempSync(join(tmpdir(), 'hive-relay-unavailable-'))
      directories.push(userDataPath)
      const server = new OrcaRuntimeRpcServer({
        userDataPath,
        runtime: new OrcaRuntimeService(),
        methods: [],
        enableWebSocket: false
      })
      const mint = vi.spyOn(server, 'createPairingOffer')
      const offer = await server.createMobilePairingOffer({ connectionMode: 'automatic', address })
      expect(offer).toMatchObject({ available: false })
      expect(mint).not.toHaveBeenCalled()
    }
  )
})
