import { resolve } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { textPackManifestFixture } from '../native-chat/hive-agent-text-pack.test-fixture'
import { verifyManagedPiRuntimeIdentity } from './managed-pi-runtime-identity'

vi.mock('../../shared/child-process/run-process', () => ({ runProcess: vi.fn() }))
const probe = vi.mocked(runProcess)
const manifest = textPackManifestFixture()
const identity = {
  schemaVersion: 1,
  nodeVersion: manifest.nodeVersion,
  piCoreVersion: manifest.piCoreVersion,
  piAiVersion: manifest.piAiVersion,
  platform: manifest.platform,
  architecture: manifest.architecture,
  toolPolicy: 'empty',
  protocols: ['CHAT_COMPLETIONS', 'RESPONSES']
}
function fixture() {
  const assertCurrent = vi.fn()
  const files = Object.freeze({
    node: resolve('verified/node'),
    runner: resolve('verified/agent.cjs')
  })
  const pack = {
    readPack: vi.fn(() => ({ manifest: structuredClone(manifest), assertCurrent })),
    getLaunchFiles: vi.fn(() => files),
    dispose: vi.fn()
  }
  return { pack, assertCurrent, files }
}
const result = () => ({
  code: 0,
  signal: null,
  timedOut: false,
  stderr: '',
  stdout: JSON.stringify(identity)
})
beforeEach(() => {
  vi.resetAllMocks()
  probe.mockResolvedValue(result())
})

it('probes only verified launch files with no prompt and retains Pack revocation', async () => {
  const { pack, assertCurrent, files } = fixture()
  const actual = await verifyManagedPiRuntimeIdentity(pack)
  expect(actual.identity).toEqual(identity)
  expect(probe).toHaveBeenCalledWith(
    expect.objectContaining({
      program: files.node,
      args: ['-e', expect.stringContaining('getManagedPiRuntimeIdentity'), files.runner],
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      terminationBarrier: true,
      env: expect.not.objectContaining({
        NODE_OPTIONS: expect.anything(),
        OPENAI_API_KEY: expect.anything()
      })
    })
  )
  expect(actual.assertCurrent).not.toThrow()
  assertCurrent.mockImplementation(() => {
    throw new Error('revoked')
  })
  expect(actual.assertCurrent).toThrow()
})

it.each([
  'nodeVersion',
  'piCoreVersion',
  'piAiVersion',
  'platform',
  'architecture',
  'toolPolicy',
  'protocols'
])('rejects mismatched %s', async (field) => {
  probe.mockResolvedValue({
    ...result(),
    stdout: JSON.stringify({ ...identity, [field]: 'incorrect' })
  })
  await expect(verifyManagedPiRuntimeIdentity(fixture().pack)).rejects.toThrow(
    /^hive_agent_pack_unavailable$/
  )
})
it.each([
  { code: 1 },
  { signal: 'SIGTERM' as const },
  { timedOut: true },
  { outputTruncated: true },
  { stderr: 'secret upstream diagnostic' },
  { stdout: '{}' },
  { stdout: 'not JSON' },
  { stdout: JSON.stringify({ ...identity, apiKey: 'secret' }) }
])('rejects failed or malformed child result %j', async (change) => {
  probe.mockResolvedValue({ ...result(), ...change })
  await expect(verifyManagedPiRuntimeIdentity(fixture().pack)).rejects.toThrow(
    /^hive_agent_pack_unavailable$/
  )
})
it('rejects revocation while the child identity is awaited', async () => {
  const { pack, assertCurrent } = fixture()
  probe.mockImplementation(async () => {
    assertCurrent.mockImplementation(() => {
      throw new Error('revoked')
    })
    return result()
  })
  await expect(verifyManagedPiRuntimeIdentity(pack)).rejects.toThrow(
    /^hive_agent_pack_unavailable$/
  )
})
it('rejects replacement even if the next snapshot keeps the old digest', async () => {
  const { pack } = fixture()
  probe.mockImplementation(async () => {
    pack.readPack.mockReturnValue({
      manifest: { ...manifest, protocols: [] },
      assertCurrent: vi.fn()
    })
    return result()
  })
  await expect(verifyManagedPiRuntimeIdentity(pack)).rejects.toThrow(
    /^hive_agent_pack_unavailable$/
  )
})
