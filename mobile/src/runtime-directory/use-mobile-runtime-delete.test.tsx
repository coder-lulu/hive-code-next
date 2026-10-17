import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { MobileApiError } from '../auth/mobile-sms-client'
import { AccountRuntimeDirectoryEntrySchema } from './account-runtime-directory-types'
import { useMobileRuntimeDelete } from './use-mobile-runtime-delete'
import { recoverRuntimeDeleteConnections } from './mobile-runtime-delete-recovery'
vi.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }))

const api = vi.hoisted(() => ({
  list: vi.fn(),
  sms: vi.fn(),
  unlink: vi.fn(),
  cleanup: vi.fn(),
  retire: vi.fn(),
  forget: vi.fn(),
  supported: true,
  storage: new Map<string, string>(),
  prepare: vi.fn(),
  finish: vi.fn(),
  session: null as MobileSession | null
}))
vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ session: api.session })
}))
vi.mock('../transport/client-context', () => ({
  useRpcClientContext: () => ({ forgetHostClient: api.forget })
}))
vi.mock('./account-runtime-directory-provider', () => ({
  useAccountRuntimeDirectory: () => ({ confirmRuntimeUnlinked: api.retire })
}))
vi.mock('./account-runtime-directory-client', () => ({ loadAllAccountRuntimes: api.list }))
vi.mock('./mobile-runtime-unlink-client', () => ({
  requestMobileRuntimeUnlinkSms: api.sms,
  unlinkMobileRuntime: api.unlink
}))
vi.mock('./mobile-runtime-delete-cleanup', () => ({
  clearUnlinkedRuntimeConnections: api.cleanup,
  runtimeDeletionSupportedOnThisSurface: () => api.supported
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getAllKeys: async () => [...api.storage.keys()],
    getItem: async (key: string) => api.storage.get(key) ?? null,
    setItem: api.prepare,
    removeItem: api.finish
  }
}))
vi.mock('../transport/host-list-mutation-queue', () => ({
  hostListMutationsSettled: async () => {}
}))
vi.mock('../transport/host-metadata-store', () => ({
  readStoredHostProfilesForMutation: async () => []
}))
vi.mock('../auth/mobile-sms-client', () => ({
  MobileApiError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly category?: string,
      readonly retryable = false,
      readonly retryAfterMs: number | null = null
    ) {
      super(message)
    }
  }
}))
const session: MobileSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  authorityId: 'cloud',
  account: { accountId: 'account-a', displayName: 'Account A' },
  expiresAt: 2_000_000_000_000,
  sessionExpiresAt: 2_100_000_000_000,
  sessionProfile: 'TRUSTED'
}
const entry = AccountRuntimeDirectoryEntrySchema.parse({
  runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cloudDisplayName: '家里电脑',
  cloudDisplayNameVersion: 1,
  resourceVersion: 3,
  status: 'CLAIMED',
  runtimeVersion: '1.5',
  runtimeProtocolVersion: 3,
  capabilities: [],
  createdAt: '2026-10-17T01:00:00Z',
  updatedAt: '2026-10-17T01:00:00Z',
  presence: 'OFFLINE'
})
const sms = {
  challengeId: 'a'.repeat(32),
  phoneNumberMasked: '138****0000',
  expiresInSeconds: 120,
  resendAfterSeconds: 60
}
let model!: ReturnType<typeof useMobileRuntimeDelete>
let renderer: ReactTestRenderer | null = null
function Probe({ requested = session }: { requested?: MobileSession }) {
  model = useMobileRuntimeDelete(entry.runtimeRecordId, requested)
  return null
}
async function mount() {
  await act(async () => {
    renderer = create(createElement(Probe))
  })
}
async function prepare() {
  await mount()
  await act(async () => model.sendSms())
  act(() => {
    model.setConfirmationName('家里电脑')
    model.setSmsCode('123456')
  })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-17T01:00:00Z'))
  vi.clearAllMocks()
  api.storage.clear()
  api.prepare.mockReset().mockImplementation(async (key: string, value: string) => {
    api.storage.set(key, value)
  })
  api.finish.mockReset().mockImplementation(async (key: string) => {
    api.storage.delete(key)
  })
  api.session = session
  api.supported = true
  api.list.mockReset().mockResolvedValue([entry])
  api.sms.mockReset().mockResolvedValue(sms)
  api.unlink.mockReset().mockResolvedValue({ status: 'UNLINKED' })
  api.cleanup.mockReset().mockResolvedValue(undefined)
  api.retire.mockReset().mockReturnValue(true)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

it('loads an offline account Runtime and requires the exact name and live SMS proof', async () => {
  await mount()
  expect(model.entry?.presence).toBe('OFFLINE')
  act(() => {
    model.setConfirmationName('家里电脑')
    model.setSmsCode('123456')
  })
  await act(async () => model.confirm())
  expect(api.unlink).not.toHaveBeenCalled()
  await act(async () => model.sendSms())
  act(() => {
    model.setConfirmationName('其他电脑')
    model.setSmsCode('123456')
  })
  expect(model.canSubmit).toBe(false)
  await act(async () => model.confirm())
  expect(api.unlink).not.toHaveBeenCalled()
})

it('submits once, retires account state, then cleans local aliases before reporting success', async () => {
  await prepare()
  const pending = deferred<void>()
  api.cleanup.mockReturnValueOnce(pending.promise)
  let operation!: Promise<void>
  act(() => {
    operation = model.confirm()
    void model.confirm()
  })
  await act(async () => {
    await Promise.resolve()
  })
  expect(api.unlink).toHaveBeenCalledOnce()
  expect(api.unlink.mock.calls[0]?.slice(0, 3)).toEqual([
    session,
    entry,
    { smsChallengeId: sms.challengeId, smsCode: '123456' }
  ])
  expect(api.retire).toHaveBeenCalledWith(
    entry.runtimeRecordId,
    {
      authorityId: 'cloud',
      accountId: 'account-a'
    },
    entry.resourceVersion
  )
  expect(model.cloudConfirmed).toBe(true)
  expect(model.completed).toBe(false)
  expect(model.sms).toBeNull()
  await act(async () => {
    pending.resolve()
    await operation
  })
  expect(model.completed).toBe(true)
  await act(async () => model.confirm())
  expect(api.unlink).toHaveBeenCalledOnce()
})

it('retries only phone cleanup after cloud success, without consuming another SMS', async () => {
  await prepare()
  api.cleanup.mockRejectedValueOnce(new Error('storage unavailable'))
  await act(async () => model.confirm())
  expect(model.cloudConfirmed).toBe(true)
  expect(model.error).toContain('重试清理')
  await act(async () => {
    await model.sendSms()
    await model.confirm()
    await model.retryCleanup()
  })
  expect(api.unlink).toHaveBeenCalledOnce()
  expect(api.sms).toHaveBeenCalledOnce()
  expect(api.cleanup).toHaveBeenCalledTimes(2)
  expect(model.completed).toBe(true)
})

it('keeps cloud success retryable when directory retirement itself fails', async () => {
  await prepare()
  api.retire.mockImplementationOnce(() => {
    throw new Error('retire failed')
  })
  await act(async () => model.confirm())
  expect(model.cloudConfirmed).toBe(true)
  expect(model.uncertain).toBe(false)
  await act(async () => model.retryCleanup())
  expect(model.completed).toBe(true)
  expect(api.unlink).toHaveBeenCalledOnce()
})

it.each([
  new Error('invalid response'),
  new MobileApiError('timeout', 408, undefined, true),
  new MobileApiError('server', 503, undefined, true)
])(
  'blocks a possibly committed unlink until a fresh directory read confirms absence: %s',
  async (failure) => {
    await prepare()
    api.unlink.mockRejectedValueOnce(failure)
    await act(async () => model.confirm())
    expect(model.uncertain).toBe(true)
    expect(model.sms).toBeNull()
    expect(api.cleanup).not.toHaveBeenCalled()
    await act(async () => {
      await model.confirm()
      await model.sendSms()
    })
    expect(api.unlink).toHaveBeenCalledOnce()
    expect(api.sms).toHaveBeenCalledOnce()
    api.list.mockResolvedValueOnce([])
    await act(async () => model.review())
    expect(model.completed).toBe(true)
  }
)

it('keeps uncertainty after a failed read; a fresh owned row requires new SMS and confirmation', async () => {
  await prepare()
  api.unlink.mockRejectedValueOnce(new MobileApiError('timeout', 408, undefined, true))
  await act(async () => model.confirm())
  api.list.mockRejectedValueOnce(new Error('incomplete page'))
  await act(async () => model.review())
  expect(model.uncertain).toBe(true)
  expect(api.cleanup).not.toHaveBeenCalled()
  api.list.mockResolvedValueOnce([{ ...entry, resourceVersion: 5, cloudDisplayName: '新名称' }])
  await act(async () => model.review())
  expect(model.uncertain).toBe(false)
  expect(model.entry?.resourceVersion).toBe(5)
  expect(model.confirmationName).toBe('')
  expect(model.canSubmit).toBe(false)
  expect(model.sms).toBeNull()
  expect(api.storage.size).toBe(1)
})

it('retains recovery when a later rejection follows an earlier uncertain write', async () => {
  await prepare()
  api.unlink.mockRejectedValueOnce(new MobileApiError('timeout', 408, undefined, true))
  await act(async () => model.confirm())
  await act(async () => model.review())
  expect(api.storage.size).toBe(1)
  act(() => {
    vi.advanceTimersByTime(61_000)
  })
  await act(async () => model.sendSms())
  act(() => {
    model.setConfirmationName('家里电脑')
    model.setSmsCode('123456')
  })
  api.unlink.mockRejectedValueOnce(new MobileApiError('conflict', 409, undefined, false))
  await act(async () => model.confirm())
  expect(api.storage.size).toBe(1)
  api.list.mockResolvedValueOnce([])
  await act(async () => model.review())
  expect(model.completed).toBe(true)
})

it('recovers a potentially committed operation after leaving and reopening the route', async () => {
  await prepare()
  const pending = deferred<unknown>()
  api.unlink.mockReturnValueOnce(pending.promise)
  let operation!: Promise<void>
  act(() => {
    operation = model.confirm()
  })
  await act(async () => {
    await Promise.resolve()
  })
  act(() => renderer!.unmount())
  await act(async () => {
    pending.resolve({ status: 'UNLINKED' })
    await operation
  })
  expect(api.cleanup).not.toHaveBeenCalled()
  api.list.mockResolvedValueOnce([])
  await mount()
  expect(model.completed).toBe(true)
  expect(api.unlink).toHaveBeenCalledOnce()
})

it('does not clean phone records for an initially missing Runtime without an unresolved operation', async () => {
  api.list.mockResolvedValueOnce([])
  await mount()
  expect(model.error).toContain('不在当前账号')
  await act(async () => {
    await model.confirm()
    await model.sendSms()
    await model.retryCleanup()
  })
  expect(api.unlink).not.toHaveBeenCalled()
  expect(api.cleanup).not.toHaveBeenCalled()
})

it('fences late results and local cleanup after the account or authenticated session changes', async () => {
  await prepare()
  const pending = deferred<unknown>()
  api.unlink.mockReturnValueOnce(pending.promise)
  let operation!: Promise<void>
  act(() => {
    operation = model.confirm()
  })
  api.session = { ...session, sessionExpiresAt: session.sessionExpiresAt + 1 }
  act(() => renderer!.update(createElement(Probe)))
  await act(async () => {
    pending.resolve({ status: 'UNLINKED' })
    await operation
  })
  expect(api.retire).not.toHaveBeenCalled()
  expect(api.cleanup).not.toHaveBeenCalled()
})

it.each(['sms', 'unlink'] as const)(
  'requires a new review on a version conflict during %s',
  async (kind) => {
    await prepare()
    const conflict = new MobileApiError('conflict', 409, 'runtime_claim_recovery_conflict', false)
    if (kind === 'sms') {
      act(() => {
        vi.advanceTimersByTime(61_000)
      })
      api.sms.mockRejectedValueOnce(conflict)
      await act(async () => model.sendSms())
    } else {
      api.unlink.mockRejectedValueOnce(conflict)
      await act(async () => model.confirm())
    }
    expect(model.entry).toBeNull()
    expect(model.sms).toBeNull()
    expect(model.confirmationName).toBe('')
    expect(api.cleanup).not.toHaveBeenCalled()
  }
)

it('enforces cooldown, SMS expiry and daily SMS quota', async () => {
  await prepare()
  await act(async () => model.sendSms())
  expect(api.sms).toHaveBeenCalledOnce()
  act(() => {
    vi.advanceTimersByTime(121_000)
  })
  expect(model.smsExpired).toBe(true)
  await act(async () => model.confirm())
  expect(api.unlink).not.toHaveBeenCalled()
  api.sms.mockRejectedValueOnce(
    new MobileApiError('daily', 429, 'runtime_claim_sms_daily_limit', false)
  )
  await act(async () => model.sendSms())
  expect(model.error).toContain('今日')
  act(() => {
    vi.advanceTimersByTime(61_000)
  })
  await act(async () => model.sendSms())
  expect(api.sms).toHaveBeenCalledTimes(2)
})

it('requires login on 401 and refuses cloud mutation on the browser-only surface', async () => {
  api.list.mockRejectedValueOnce(new MobileApiError('unauthorized', 401, undefined, false))
  await mount()
  expect(model.requiresLogin).toBe(true)
  await act(async () => {
    await model.review()
    await model.sendSms()
  })
  expect(api.list).toHaveBeenCalledOnce()
  act(() => renderer!.unmount())
  api.supported = false
  await mount()
  expect(model.unsupported).toBe(true)
  expect(model.loading).toBe(false)
  await act(async () => {
    await model.review()
    await model.sendSms()
    await model.confirm()
  })
  expect(api.list).toHaveBeenCalledOnce()
  expect(api.sms).not.toHaveBeenCalled()
  expect(api.unlink).not.toHaveBeenCalled()
})

it('does not submit unlink if the recovery record cannot be saved', async () => {
  await prepare()
  api.prepare.mockRejectedValueOnce(new Error('storage full'))
  await act(async () => model.confirm())
  expect(api.unlink).not.toHaveBeenCalled()
  expect(api.cleanup).not.toHaveBeenCalled()
  expect(model.uncertain).toBe(false)
  expect(model.error).toContain('保存本机清理记录')
})

it('keeps cloud success retryable if finishing the durable cleanup record fails', async () => {
  await prepare()
  api.finish.mockRejectedValueOnce(new Error('storage write failed'))
  await act(async () => model.confirm())
  expect(model.cloudConfirmed).toBe(true)
  expect(model.completed).toBe(false)
  await act(async () => model.retryCleanup())
  expect(model.completed).toBe(true)
  expect(api.unlink).toHaveBeenCalledOnce()
})

it('accepts background completion while the deletion result review is in flight', async () => {
  await prepare()
  api.unlink.mockRejectedValueOnce(new MobileApiError('timeout', 408, undefined, true))
  await act(async () => model.confirm())
  const response = deferred<never[]>()
  const started = deferred<void>()
  api.list.mockImplementationOnce(() => {
    started.resolve()
    return response.promise
  })
  let review!: Promise<void>
  await act(async () => {
    review = model.review()
    await started.promise
  })
  await act(async () =>
    recoverRuntimeDeleteConnections(session, [], api.forget, () => true, Date.now() + 1)
  )
  expect(api.storage.size).toBe(0)
  await act(async () => {
    response.resolve([])
    await review
  })
  expect(model.completed).toBe(true)
  expect(model.error).toBeNull()
  expect(api.cleanup).toHaveBeenCalledOnce()
  await act(async () => model.retryCleanup())
  expect(api.cleanup).toHaveBeenCalledOnce()
  expect(api.unlink).toHaveBeenCalledOnce()
})

it('serializes a background recovery against the foreground cleanup of the same task', async () => {
  await prepare()
  const started = deferred<void>()
  const response = deferred<void>()
  api.cleanup.mockImplementationOnce(() => {
    started.resolve()
    return response.promise
  })
  let confirm!: Promise<void>
  await act(async () => {
    confirm = model.confirm()
    await started.promise
  })
  const background = recoverRuntimeDeleteConnections(
    session,
    [],
    api.forget,
    () => true,
    Date.now() + 1
  )
  await act(async () => {
    response.resolve()
    await confirm
    await background
  })
  expect(api.cleanup).toHaveBeenCalledOnce()
  expect(api.storage.size).toBe(0)
  expect(model.completed).toBe(true)
})

it('preserves a newer claim instead of retrying old local cleanup or cloud unlink', async () => {
  await prepare()
  api.cleanup.mockRejectedValueOnce(new Error('cache IO failure'))
  await act(async () => model.confirm())
  api.retire.mockReturnValue(false)
  await act(async () => model.retryCleanup())
  expect(api.retire).toHaveBeenLastCalledWith(
    entry.runtimeRecordId,
    { authorityId: session.authorityId, accountId: session.account.accountId },
    entry.resourceVersion
  )
  expect(model.completed).toBe(true)
  expect(model.superseded).toBe(true)
  expect(model.error).toBeNull()
  expect(api.cleanup).toHaveBeenCalledOnce()
  expect(api.unlink).toHaveBeenCalledOnce()
  expect(api.storage.size).toBe(0)
})
