import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  ensureStructuredAgentSessionHost,
  getStructuredAgentSessionResources,
  stopStructuredAgentSessionRuntime
} from './structured-agent-session-runtime'

let directory: string | undefined
afterEach(async () => {
  await stopStructuredAgentSessionRuntime()
  if (directory) {
    await rm(directory, { recursive: true, force: true })
  }
  directory = undefined
})
async function install() {
  if (!directory) {
    const root = join(process.cwd(), 'logs/p4-session-resources')
    await mkdir(root, { recursive: true })
    directory = await mkdtemp(join(root, 'store-'))
  }
  return ensureStructuredAgentSessionHost({
    stateDirectory: directory,
    hostId: 'local',
    claimKeyId: 'key',
    resolveWorkspacePath: async () => directory!,
    resolveEnvironment: async () => ({}),
    resolveClaudeAuthPolicy: () => ({ stripAuthEnv: true })
  })
}
it('does not open another store when no runtime has been installed', async () => {
  await expect(getStructuredAgentSessionResources()).rejects.toThrow(
    'hive_agent_capability_unavailable'
  )
})
it('shares the same installed store and invalidates its handle synchronously on stop', async () => {
  await install()
  const first = await getStructuredAgentSessionResources()
  const second = await getStructuredAgentSessionResources()
  expect(first.store).toBe(second.store)
  expect(first.stateDirectory).toBe(directory)
  expect(first.claimKeyId).toBe('key')
  first.assertCurrent()
  const stopped = stopStructuredAgentSessionRuntime()
  expect(() => first.assertCurrent()).toThrow('hive_agent_capability_unavailable')
  await expect(getStructuredAgentSessionResources()).rejects.toThrow(
    'hive_agent_capability_unavailable'
  )
  await stopped
  await install()
  const next = await getStructuredAgentSessionResources()
  expect(next.store).not.toBe(first.store)
  next.assertCurrent()
  expect(() => first.assertCurrent()).toThrow('hive_agent_capability_unavailable')
})
