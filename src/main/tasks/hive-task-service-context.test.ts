import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { createHiveTaskServiceContext } from './hive-task-service-context'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'task-service-context-'))
  await writeFile(
    join(directory, 'descriptor.json'),
    JSON.stringify({ baseUrl: 'http://127.0.0.1:1', secret: 'test-only-descriptor' })
  )
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function fixture() {
  let guard: () => void = () => undefined
  let account: HiveRuntimeCloudAuthorization = {
    accountId: 'account:service-context',
    authorityId: 'authority:service-context',
    sessionGeneration: 1,
    sessionExpiresAt: Date.now() + 60_000,
    accessToken: 'test-only-token'
  }
  const request = vi.fn(async () => ({ acknowledged: true }))
  const createRequest = vi.fn(() => request)
  const context = createHiveTaskServiceContext({
    descriptorPath: join(directory, 'descriptor.json'),
    currentAccount: () => account,
    assertCurrent: () => guard(),
    request: createRequest
  })
  return {
    context,
    account,
    request,
    createRequest,
    setGuard(value: () => void) {
      guard = value
    },
    changeAccountGeneration() {
      account = { ...account, sessionGeneration: account.sessionGeneration + 1 }
    }
  }
}

describe('original Task service authority', () => {
  it('preserves a synchronous original guard and authenticated request', async () => {
    const current = fixture()
    const context = await current.context()
    expect(context.accountId).toBe(current.account.accountId)
    await expect(context.request('/hive/test')).resolves.toEqual({ acknowledged: true })
    expect(current.request).toHaveBeenCalledOnce()
  })
  it('refuses an asynchronous original guard before reading service dependencies', async () => {
    const current = fixture()
    current.setGuard(() => Promise.resolve())
    await expect(current.context()).rejects.toThrow('FORBIDDEN')
    expect(current.createRequest).not.toHaveBeenCalled()
  })
  it('rechecks the original guard after awaiting the descriptor', async () => {
    const current = fixture()
    let checks = 0
    current.setGuard(() => (++checks === 1 ? undefined : Promise.resolve()))
    await expect(current.context()).rejects.toThrow('FORBIDDEN')
    expect(current.createRequest).not.toHaveBeenCalled()
  })
  it('refuses an asynchronous captured guard before dispatching a request', async () => {
    const current = fixture()
    const context = await current.context()
    current.setGuard(() => Promise.resolve())
    expect(context.assertCurrent).toThrow('FORBIDDEN')
    await expect(context.request('/hive/test')).rejects.toThrow('FORBIDDEN')
    expect(current.request).not.toHaveBeenCalled()
  })
  it('does not expose a response after the original guard becomes asynchronous', async () => {
    const current = fixture()
    const context = await current.context()
    current.request.mockImplementationOnce(async () => {
      current.setGuard(() => Promise.resolve())
      return { acknowledged: true }
    })
    await expect(context.request('/hive/test')).rejects.toThrow('FORBIDDEN')
    expect(current.request).toHaveBeenCalledOnce()
  })
  it('still rejects an authenticated account generation change', async () => {
    const current = fixture()
    const context = await current.context()
    current.changeAccountGeneration()
    expect(context.assertCurrent).toThrow('FORBIDDEN')
    await expect(context.request('/hive/test')).rejects.toThrow('FORBIDDEN')
    expect(current.request).not.toHaveBeenCalled()
  })
})
