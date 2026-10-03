import { beforeEach, expect, it, vi } from 'vitest'
import { HiveAgentLocalRuntime } from './hive-agent-local-runtime'

const mocked = vi.hoisted(() => ({
  resources: vi.fn(),
  pack: vi.fn(),
  create: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  call: vi.fn(),
  subscribe: vi.fn()
}))
vi.mock('../runtime/structured-agent-session-runtime', () => ({
  getStructuredAgentSessionResources: mocked.resources
}))
vi.mock('../runtime/managed-pi-pack-product', () => ({ loadProductManagedPiTextPack: mocked.pack }))
vi.mock('./hive-agent-cloud-host', () => ({
  HiveAgentCloudHost: class {
    constructor(options: unknown) {
      mocked.create(options)
    }
    open = mocked.open
    close = mocked.close
  }
}))
beforeEach(() => {
  vi.resetAllMocks()
  mocked.resources.mockResolvedValue({ store: { hive: { get: vi.fn() } } })
  mocked.pack.mockResolvedValue({})
  mocked.open.mockResolvedValue({ call: mocked.call, subscribe: mocked.subscribe })
  mocked.close.mockResolvedValue(undefined)
})
function setup() {
  let runtimeId = 'runtime',
    online = true,
    configured = true
  const bind = vi.fn(async (selector: string) => ({
    projectScope: selector,
    workspaceKind: 'folder',
    resolvePrincipal: () => ({ accountId: 'account' }),
    assertAuthorized: vi.fn()
  }))
  const ensure = vi.fn(async () => {})
  const owner = new HiveAgentLocalRuntime({
    account: { getRuntimeCloudAuthorization: () => null, resolveAiModelForGeneration: vi.fn() },
    presence: {
      getCurrentLeaseContext: () => (online ? { tuple: { runtimeRecordId: runtimeId } } : null)
    },
    principal: { bindProject: bind, eligibilityRevision: () => 1 },
    runtime: { ensureStructuredAgentSessionHost: ensure },
    getConfig: () => ({ configured, config: { apiBaseUrl: 'https://cloud.test' } }),
    resourcesDirectory: 'E:/product/out'
  } as unknown as ConstructorParameters<typeof HiveAgentLocalRuntime>[0])
  return {
    owner,
    bind,
    ensure,
    offline: () => {
      online = false
    },
    unconfigure: () => {
      configured = false
    },
    replace: () => {
      runtimeId = 'replacement'
    }
  }
}
it('retains legacy history and deletion but refuses new custom execution', async () => {
  const test = setup()
  const project = await test.owner.openProject('folder:a')
  for (const method of ['hiveAgent.create', 'hiveAgent.submit']) {
    await expect(project.call(method, {})).rejects.toThrow('hive_agent_capability_unavailable')
  }
  expect(mocked.call).not.toHaveBeenCalled()
  await project.call('hiveAgent.history', { sessionId: 'old' })
  await project.call('hiveAgent.delete', { sessionId: 'old' })
  expect(mocked.call).toHaveBeenCalledTimes(2)
  await test.owner.close()
})
it('serializes first opens and shares one verified product host across projects', async () => {
  const test = setup()
  const [a, b] = await Promise.all([
    test.owner.openProject('folder:a'),
    test.owner.openProject('folder:b')
  ])
  expect(mocked.create).toHaveBeenCalledOnce()
  expect(mocked.pack).toHaveBeenCalledExactlyOnceWith('E:/product/out')
  expect(test.ensure).toHaveBeenCalledOnce()
  a.call('hiveAgent.read', { sessionId: 'a' })
  b.call('hiveAgent.read', { sessionId: 'b' })
  expect(mocked.call).toHaveBeenCalledTimes(2)
  expect(mocked.call.mock.calls[0][2]).not.toBe(mocked.call.mock.calls[1][2])
  await test.owner.close()
  expect(mocked.close).toHaveBeenCalledOnce()
})
it('closes the old host before installing one for a replacement Runtime', async () => {
  const test = setup()
  await test.owner.openProject('folder:a')
  test.replace()
  await test.owner.openProject('folder:a')
  expect(mocked.create).toHaveBeenCalledTimes(2)
  expect(mocked.close.mock.invocationCallOrder[0]).toBeLessThan(
    mocked.create.mock.invocationCallOrder[1]
  )
  await test.owner.close()
})
it.each(['offline', 'unconfigure'] as const)('does not load a Pack while %s', async (field) => {
  const test = setup()
  test[field]()
  await expect(test.owner.openProject('folder:a')).rejects.toThrow(
    'hive_agent_capability_unavailable'
  )
  expect(mocked.pack).not.toHaveBeenCalled()
  expect(mocked.create).not.toHaveBeenCalled()
  await test.owner.close()
})
it('cleans failed installation and allows a later explicit attempt', async () => {
  const test = setup()
  mocked.open.mockRejectedValueOnce(new Error('failed'))
  await expect(test.owner.openProject('folder:a')).rejects.toThrow('failed')
  expect(mocked.close).toHaveBeenCalledOnce()
  await test.owner.openProject('folder:a')
  expect(mocked.create).toHaveBeenCalledTimes(2)
  await test.owner.close()
})
it('installs a history-only host when the product Pack is unavailable', async () => {
  const test = setup()
  mocked.pack.mockRejectedValue(new Error('hive_agent_pack_unavailable'))
  const project = await test.owner.openProject('folder:a')
  await project.call('hiveAgent.history', { sessionId: 'a' })
  expect(mocked.create).toHaveBeenCalledWith(expect.objectContaining({ pack: null }))
  expect(mocked.call).toHaveBeenCalledOnce()
  await test.owner.close()
})
it('does not hide an unexpected installation error as Pack unavailability', async () => {
  const test = setup()
  mocked.pack.mockRejectedValue(new Error('unexpected'))
  await expect(test.owner.openProject('folder:a')).rejects.toThrow('unexpected')
  expect(mocked.create).not.toHaveBeenCalled()
  await test.owner.close()
})
it('retains an owner whose close fails for a later close retry', async () => {
  const test = setup()
  await test.owner.openProject('folder:a')
  mocked.close.mockRejectedValueOnce(new Error('busy'))
  await expect(test.owner.close()).rejects.toThrow('busy')
  await test.owner.close()
  expect(mocked.close).toHaveBeenCalledTimes(2)
  await expect(test.owner.openProject('folder:a')).rejects.toThrow(
    'hive_agent_capability_unavailable'
  )
})
it('does not install after shutdown during Pack loading', async () => {
  const test = setup()
  let release!: (value: unknown) => void
  mocked.pack.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const opening = expect(test.owner.openProject('folder:a')).rejects.toThrow(
    'hive_agent_capability_unavailable'
  )
  await vi.waitFor(() => expect(mocked.pack).toHaveBeenCalledOnce())
  const closing = test.owner.close()
  release({})
  await opening
  await closing
  expect(mocked.create).not.toHaveBeenCalled()
})
