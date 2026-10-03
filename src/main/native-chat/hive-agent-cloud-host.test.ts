import { beforeEach, expect, it, vi } from 'vitest'
import type { HiveAgentHostDependencies } from './hive-agent-session-dependencies'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import type { VerifiedManagedPiPack } from '../runtime/managed-pi-runtime-identity'
import { HiveAgentCloudHost } from './hive-agent-cloud-host'

const mocks = vi.hoisted(() => ({
  execution: vi.fn(),
  host: vi.fn(),
  journalOpen: vi.fn(),
  journalClose: vi.fn(),
  hostClose: vi.fn(),
  executionClose: vi.fn(),
  assertCurrent: vi.fn()
}))
vi.mock('./managed-pi-execution-host', () => ({ createManagedPiExecutionHost: mocks.execution }))
vi.mock('./hive-agent-session-host', () => ({ HiveAgentSessionHost: { open: mocks.host } }))
vi.mock('./agent-session-journal/journal-store', () => ({
  AgentSessionJournal: class {
    open = mocks.journalOpen
    close = mocks.journalClose
  }
}))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.executionClose.mockResolvedValue(undefined)
  mocks.hostClose.mockImplementation(async () => {
    await mocks.executionClose()
  })
  mocks.execution.mockResolvedValue({
    adapter: {},
    readPack: () => null,
    fenceFor: () => 1,
    release: vi.fn(),
    close: mocks.executionClose
  })
  mocks.host.mockResolvedValue({ close: mocks.hostClose })
  mocks.journalOpen.mockResolvedValue(undefined)
  mocks.journalClose.mockResolvedValue(undefined)
})
function instance(pack: VerifiedManagedPiPack | null = {} as VerifiedManagedPiPack) {
  return new HiveAgentCloudHost({
    resources: {
      store: { hostId: 'local', hive: { get: () => undefined } },
      stateDirectory: 'E:/test-profile',
      claimKeyId: 'key',
      assertCurrent: mocks.assertCurrent
    },
    pack,
    origin: 'https://cloud.test',
    runtimeRecordId: '11111111-1111-4111-8111-111111111111',
    account: { getRuntimeCloudAuthorization: () => null },
    presence: { getCurrentLeaseContext: () => null },
    scopeFor: vi.fn(),
    assertAuthorized: vi.fn(),
    principalForSession: () => null,
    eligibilityRevision: () => 1,
    assertOrigin: () => {},
    resolveModel: vi.fn()
  } as unknown as ConstructorParameters<typeof HiveAgentCloudHost>[0])
}
const entry = {
  accountId: 'account',
  deviceId: 'device',
  projectScope: 'folder:project',
  aggregate: {
    session: { sessionId: 'ha-session:11111111-1111-4111-8111-111111111111' },
    binding: { providerKind: 'managed-pi' }
  }
} as HiveAgentSessionEntry

it('opens and closes history journals without constructing execution when the Pack is missing', async () => {
  mocks.hostClose.mockResolvedValue(undefined)
  const owner = instance(null)
  await owner.open()
  expect(mocks.execution).not.toHaveBeenCalled()
  const deps = mocks.host.mock.calls[0][0] as HiveAgentHostDependencies
  expect(deps.executionUnavailable).toBe('hive_agent_pack_unavailable')
  expect(deps.enabled()).toBe(false)
  expect(deps.adapter).toBeUndefined()
  await deps.journalFor(entry)
  await owner.close()
  expect(mocks.journalClose).toHaveBeenCalledOnce()
  expect(mocks.executionClose).not.toHaveBeenCalled()
})

it('opens one execution host and one product host for concurrent callers', async () => {
  const owner = instance()
  const [one, two] = await Promise.all([owner.open(), owner.open()])
  expect(one).toBe(two)
  expect(mocks.execution).toHaveBeenCalledOnce()
  expect(mocks.host).toHaveBeenCalledOnce()
  await owner.close()
  await expect(owner.open()).rejects.toThrow('hive_agent_capability_unavailable')
})
it('shares one journal per identity and closes it only after host/process disposal', async () => {
  const owner = instance()
  await owner.open()
  const deps = mocks.host.mock.calls[0][0] as HiveAgentHostDependencies
  const journals = await Promise.all([deps.journalFor(entry), deps.journalFor(entry)])
  expect(journals[0]).toBe(journals[1])
  expect(mocks.journalOpen).toHaveBeenCalledOnce()
  await expect(deps.journalFor({ ...entry, deviceId: 'other' })).rejects.toThrow(
    'hive_agent_forbidden'
  )
  await owner.close()
  expect(mocks.executionClose.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.journalClose.mock.invocationCallOrder[0]
  )
  await owner.close()
  expect(mocks.journalClose).toHaveBeenCalledOnce()
})
it('retains journals if process close fails, and retries before closing their handles', async () => {
  const owner = instance()
  await owner.open()
  await (mocks.host.mock.calls[0][0] as HiveAgentHostDependencies).journalFor(entry)
  mocks.executionClose.mockRejectedValueOnce(new Error('not stopped'))
  await expect(owner.close()).rejects.toThrow('not stopped')
  expect(mocks.journalClose).not.toHaveBeenCalled()
  await owner.close()
  expect(mocks.journalClose).toHaveBeenCalledOnce()
})
it('retains a failed journal close for a later close attempt', async () => {
  const owner = instance()
  await owner.open()
  await (mocks.host.mock.calls[0][0] as HiveAgentHostDependencies).journalFor(entry)
  mocks.journalClose.mockRejectedValueOnce(new Error('busy'))
  await expect(owner.close()).rejects.toThrow('hive_agent_outcome_unknown')
  await owner.close()
  expect(mocks.journalClose).toHaveBeenCalledTimes(2)
})
it('closes a partially opened journal when recovery prevents host installation', async () => {
  const owner = instance()
  mocks.journalOpen.mockRejectedValue(new Error('open failed'))
  mocks.host.mockImplementation(async (deps: HiveAgentHostDependencies) => {
    await deps.journalFor(entry)
  })
  await expect(owner.open()).rejects.toThrow('hive_agent_capability_unavailable')
  expect(mocks.executionClose).toHaveBeenCalledOnce()
  expect(mocks.journalClose).toHaveBeenCalledOnce()
  await owner.close()
})
it('fences startup before the product host is published when close races execution setup', async () => {
  const owner = instance()
  let release!: (value: unknown) => void
  mocks.execution.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const opened = expect(owner.open()).rejects.toThrow('hive_agent_capability_unavailable')
  const closing = owner.close()
  release({ close: mocks.executionClose })
  await opened
  await closing
  expect(mocks.host).not.toHaveBeenCalled()
  expect(mocks.executionClose).toHaveBeenCalled()
})
it('does not open execution resources after the underlying Runtime has been detached', async () => {
  const owner = instance()
  mocks.assertCurrent.mockImplementation(() => {
    throw new Error('detached')
  })
  await expect(owner.open()).rejects.toThrow('hive_agent_capability_unavailable')
  expect(mocks.execution).not.toHaveBeenCalled()
  await owner.close()
})

it('disables the product host after its shared Runtime is detached', async () => {
  const owner = instance()
  await owner.open()
  const deps = mocks.host.mock.calls[0][0] as HiveAgentHostDependencies
  expect(deps.enabled()).toBe(true)
  mocks.assertCurrent.mockImplementation(() => {
    throw new Error('detached')
  })
  expect(deps.enabled()).toBe(false)
  await expect(deps.journalFor(entry)).rejects.toThrow('detached')
  expect(mocks.journalOpen).not.toHaveBeenCalled()
  await owner.close()
})
