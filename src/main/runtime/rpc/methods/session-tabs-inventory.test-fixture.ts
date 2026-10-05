import { afterEach, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installFakeAppEnvironment } from '../../../../../config/scripts/vitest-host-ports-setup'
import { stopStructuredAgentSessionRuntime } from '../../structured-agent-session-runtime'

export function installSessionTabsInventoryEnvironment(): void {
  let stateDirectory: string
  beforeEach(async () => {
    stateDirectory = await mkdtemp(join(tmpdir(), 'session-tabs-inventory-'))
    installFakeAppEnvironment({ getPath: (name) => (name === 'temp' ? tmpdir() : stateDirectory) })
  })
  afterEach(async () => {
    await stopStructuredAgentSessionRuntime()
    await rm(stateDirectory, { recursive: true, force: true })
  })
}
