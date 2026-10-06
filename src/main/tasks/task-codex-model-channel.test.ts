import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTaskCodexModelChannel } from './task-codex-model-channel'
import { createTaskModelDispatchFixture } from './task-model-dispatch.test-fixture'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import {
  modelResponse,
  modelStartParams,
  finishModelRequest
} from './task-model-broker.test-fixture'
import type { TaskCodexAccountScope } from './task-codex-account-scope'
import type { getCodexBackendAuthHeaders } from '../rate-limits/codex-backend-auth'
import {
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore
} from '../runtime/agent-session-record-store-test-harness'

let directory: string
const channels: ReturnType<typeof createTaskCodexModelChannel>[] = []
beforeEach(async () => {
  const root = resolve('logs/paperclip-development/p3/task-model-failure-diagnostics/writer/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'channel-'))
  vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW)
})
afterEach(async () => {
  await Promise.all(channels.splice(0).map((channel) => channel.close()))
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

function requestParams() {
  const profile = taskDockerModelProfile()
  return modelStartParams({
    model: profile.model,
    input: [
      { type: 'additional_tools', role: 'developer', tools: profile.approvedTools },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Write a report.' }] }
    ],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    reasoning: { effort: 'low', context: 'all_turns' },
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content']
  })
}

async function fixture() {
  const owner = await createTaskModelDispatchFixture(directory)
  let revoked = false
  const account: TaskCodexAccountScope = Object.freeze({
    accountId: 'fixture-managed-row',
    codexHome: owner.binding.accountHome.path,
    providerAccountId: 'fixture-provider',
    assertCurrent: vi.fn(() => {
      if (revoked) {
        throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
      }
    }),
    assertMetadataCurrent: vi.fn<() => void>()
  })
  const auth = {
    Authorization: 'Bearer fixture_offline',
    'ChatGPT-Account-Id': account.providerAccountId
  }
  const readAuth = vi.fn<typeof getCodexBackendAuthHeaders>(async () => auth)
  const response = modelResponse()
  const request = vi.fn<typeof fetch>(async () => response.reply)
  const assertCurrent = vi.fn(() => {
    owner.validate()
    owner.store.tasks.assertStructuredBindingCurrent(owner.binding)
    account.assertMetadataCurrent()
  })
  const channel = createTaskCodexModelChannel({
    store: owner.store,
    binding: owner.binding,
    account,
    deadline: TASK_TEST_NOW + 120_000,
    assertCurrent,
    readAuth,
    request
  })
  channels.push(channel)
  return {
    owner,
    account,
    auth,
    readAuth,
    request,
    response,
    channel,
    assertCurrent,
    revoke: () => {
      revoked = true
    }
  }
}

describe('controlled Codex production model channel', () => {
  it('persists the safe HTTP cause in the original Task for owner observation after cleanup', async () => {
    const f = await fixture()
    const session = f.owner.store.getRecord(f.owner.binding.sessionId)
    const operations = f.owner.store.listOperationRows()
    f.request.mockResolvedValue(
      new Response('private response secret', {
        status: 429,
        headers: { authorization: 'Bearer private header secret' }
      })
    )
    await expect(f.channel.start(requestParams())).rejects.toThrow('TASK_MODEL_LIMIT_UNAVAILABLE')
    await f.channel.close()
    const persisted = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[
      f.owner.key
    ]
    expect(persisted.events.at(-1)?.summary).toBe(
      'Task model failure: {"phase":"response","category":"http","code":"TASK_MODEL_LIMIT_UNAVAILABLE","httpStatus":429}'
    )
    expect(persisted.status).toBe(f.owner.task.status)
    expect(persisted.result).toBeNull()
    expect(JSON.stringify(persisted.events)).not.toContain('secret')
    expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
    expect(f.owner.store.listOperationRows()).toEqual(operations)
    await expect(f.channel.start(requestParams())).rejects.toThrow('TASK_MODEL_CHANNEL_UNAVAILABLE')
  })
  it('commits to the original Task before reading auth and makes one scoped POST', async () => {
    const f = await fixture()
    f.readAuth.mockImplementation(async (target) => {
      expect(target).toEqual({ codexHomePath: f.account.codexHome })
      const state = await readPersistedTestAgentSessionStore(directory)
      expect(state.taskExecutions[f.owner.key].modelDispatchAttempts).toBe(1)
      return f.auth
    })
    const params = requestParams()
    await expect(f.channel.start(params)).resolves.toMatchObject({ status: 200 })
    expect(await finishModelRequest(f.channel, params.requestId)).toContain('response.completed')
    expect(f.readAuth).toHaveBeenCalledOnce()
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.owner.store.tasks.get(f.owner.command)?.modelDispatchAttempts).toBe(1)
    await f.channel.close()
  })
  it('requires a full owned-account check before taking a debit', async () => {
    const f = await fixture()
    f.revoke()
    await expect(f.channel.start(requestParams())).rejects.toThrow()
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.owner.store.tasks.get(f.owner.command)?.modelDispatchAttempts).toBeUndefined()
  })
  it('retains the debit and refuses POST when the account changes while auth is read', async () => {
    const f = await fixture()
    f.readAuth.mockImplementation(async () => {
      f.revoke()
      return f.auth
    })
    await expect(f.channel.start(requestParams())).rejects.toThrow()
    expect(f.readAuth).toHaveBeenCalledOnce()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.owner.store.tasks.get(f.owner.command)?.modelDispatchAttempts).toBe(1)
  })
  it('disposes a response when the owned-account check fails after POST', async () => {
    const f = await fixture()
    f.request.mockImplementation(async () => {
      f.revoke()
      return f.response.reply
    })
    await expect(f.channel.start(requestParams())).rejects.toThrow()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.response.cancel).toHaveBeenCalledOnce()
    expect(f.owner.store.tasks.get(f.owner.command)?.modelDispatchAttempts).toBe(1)
  })
  it('disposes a response arriving after the channel was closed while POST was pending', async () => {
    const f = await fixture()
    let complete: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      complete = resolve
    })
    let started: () => void = () => undefined
    const initiated = new Promise<void>((resolve) => {
      started = resolve
    })
    f.request.mockImplementation(() => {
      started()
      return pending
    })
    const start = f.channel.start(requestParams())
    const outcome = expect(start).rejects.toThrow()
    await initiated
    await f.channel.close()
    await outcome
    complete(f.response.reply)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.response.cancel).toHaveBeenCalledOnce()
    expect(f.owner.store.tasks.get(f.owner.command)?.modelDispatchAttempts).toBe(1)
  })
  it('reloads another client cancellation before initiating the actual POST', async () => {
    const f = await fixture()
    const other = await openTestAgentSessionRecordStore(directory)
    f.readAuth.mockImplementation(async () => {
      await other.tasks.requestCancellation(
        f.owner.command,
        'other-client-cancel',
        TASK_TEST_NOW,
        f.owner.validate
      )
      return f.auth
    })
    await expect(f.channel.start(requestParams())).rejects.toThrow()
    expect(f.readAuth).toHaveBeenCalledOnce()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.owner.store.tasks.get(f.owner.command)?.status).toBe('cancel_requested')
    expect(f.owner.store.tasks.get(f.owner.command)?.modelDispatchAttempts).toBe(1)
  })
  it('refuses an asynchronous rejected Host grant without credentials or a debit', async () => {
    const f = await fixture()
    f.assertCurrent.mockImplementation(() => Promise.reject(new Error('async-grant-denied')))
    await expect(f.channel.start(requestParams())).rejects.toThrow('TASK_MODEL_AUTHORITY_REVOKED')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.owner.store.tasks.get(f.owner.command)?.modelDispatchAttempts).toBeUndefined()
  })
})
