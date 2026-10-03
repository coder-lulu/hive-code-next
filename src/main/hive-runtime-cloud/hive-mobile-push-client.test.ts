import { describe, expect, it, vi } from 'vitest'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { MobileNotificationDispatchEvent } from '../runtime/runtime-mobile-notification-controller'
import { HiveMobilePushClient } from './hive-mobile-push-client'

const runtimeId = '11111111-1111-4111-8111-111111111111'
const deliveryId = '22222222-2222-4222-8222-222222222222'
const accountId = '33333333-3333-4333-8333-333333333333'
const authorization: HiveRuntimeCloudAuthorization = {
  accessToken: 'account-access-token',
  accountId,
  authorityId: 'authority-id',
  sessionExpiresAt: Date.now() + 60_000,
  sessionGeneration: 1
}

describe('HiveMobilePushClient', () => {
  it('sends only generic copy and bounded routing metadata through HiveCloud', async () => {
    const fetchImpl = vi.fn(
      async (_input: string, _init: RequestInit) =>
        new Response(JSON.stringify({ accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    const client = new HiveMobilePushClient({
      apiBaseUrl: 'https://api.hive.example',
      getAuthorization: () => authorization,
      getRuntimeId: () => runtimeId,
      fetchImpl
    })

    await expect(
      client.send({
        type: 'notification',
        source: 'agent-task-complete',
        title: 'private project title',
        body: 'private prompt and /secret/path',
        worktreeId: 'folder:/secret/path',
        notificationId: 'agent:stable',
        deliveryId,
        agentState: 'blocked'
      })
    ).resolves.toEqual({ accepted: true })

    const request = fetchImpl.mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body))
    expect(body).toEqual({
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/
      ),
      deliveryId,
      title: APP_DISPLAY_NAME,
      body: 'Agent needs your input',
      source: 'AGENT_TASK_COMPLETE',
      runtimeId,
      agentState: 'NEEDS_INPUT',
      sound: true
    })
    expect(JSON.stringify(body)).not.toContain('private')
    expect(JSON.stringify(body)).not.toContain('/secret/path')
    expect(request?.headers).toMatchObject({ authorization: 'Bearer account-access-token' })
  })

  it('reports unavailable without account authorization or a registered runtime', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init: RequestInit) => new Response())
    const client = new HiveMobilePushClient({
      apiBaseUrl: 'https://api.hive.example',
      getAuthorization: () => null,
      getRuntimeId: () => null,
      fetchImpl
    })
    await expect(
      client.send({ type: 'notification', source: 'test', title: '', body: '' })
    ).resolves.toEqual({ accepted: false, reason: 'unavailable' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps the authorization and runtime snapshot that supplied the presentation account', async () => {
    let currentAuthorization = authorization
    let currentRuntimeId = runtimeId
    const fetchImpl = vi.fn(
      async (_input: string, _init: RequestInit) =>
        new Response(JSON.stringify({ accepted: true }), {
          status: 202,
          headers: { 'content-type': 'application/json' }
        })
    )
    const client = new HiveMobilePushClient({
      apiBaseUrl: 'https://api.hive.example',
      getAuthorization: () => currentAuthorization,
      getRuntimeId: () => currentRuntimeId,
      fetchImpl
    })
    const prepared = client.prepare()
    expect(prepared?.accountId).toBe(accountId)

    currentAuthorization = {
      ...authorization,
      accessToken: 'other-account-access-token',
      accountId: '44444444-4444-4444-8444-444444444444'
    }
    currentRuntimeId = '55555555-5555-4555-8555-555555555555'
    await expect(
      prepared?.send({
        type: 'notification',
        source: 'test',
        title: '',
        body: '',
        deliveryId,
        accountId
      })
    ).resolves.toEqual({ accepted: true })

    const request = fetchImpl.mock.calls[0]?.[1]
    expect(request?.headers).toMatchObject({ authorization: 'Bearer account-access-token' })
    expect(JSON.parse(String(request?.body))).toMatchObject({ runtimeId, deliveryId })
  })

  it('preserves HiveCloud business rejection reasons', async () => {
    const client = new HiveMobilePushClient({
      apiBaseUrl: 'https://api.hive.example',
      getAuthorization: () => authorization,
      getRuntimeId: () => runtimeId,
      fetchImpl: async () =>
        new Response(JSON.stringify({ accepted: false, reason: 'not_registered' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    })
    await expect(
      client.send({ type: 'notification', source: 'test', title: '', body: '' })
    ).resolves.toEqual({ accepted: false, reason: 'not_registered' })
  })

  it('uses the fixed HiveCloud copy for every notification source', async () => {
    const fetchImpl = vi.fn(
      async (_input: string, _init: RequestInit) =>
        new Response(JSON.stringify({ accepted: true }), {
          status: 202,
          headers: { 'content-type': 'application/json' }
        })
    )
    const client = new HiveMobilePushClient({
      apiBaseUrl: 'https://api.hive.example',
      getAuthorization: () => authorization,
      getRuntimeId: () => runtimeId,
      fetchImpl
    })
    const cases: readonly {
      event: MobileNotificationDispatchEvent
      expectedBody: string
      expectedSource: string
      expectedAgentState?: string
    }[] = [
      {
        event: {
          type: 'notification',
          source: 'agent-task-complete',
          title: '',
          body: '',
          agentState: 'done'
        },
        expectedBody: 'Agent task finished',
        expectedSource: 'AGENT_TASK_COMPLETE',
        expectedAgentState: 'FINISHED'
      },
      {
        event: { type: 'notification', source: 'terminal-bell', title: '', body: '' },
        expectedBody: 'Terminal activity needs your attention',
        expectedSource: 'TERMINAL_BELL'
      },
      {
        event: { type: 'notification', source: 'plugin', title: '', body: '' },
        expectedBody: `A ${APP_DISPLAY_NAME} plugin sent a notification`,
        expectedSource: 'PLUGIN'
      },
      {
        event: { type: 'notification', source: 'test', title: '', body: '' },
        expectedBody: `${APP_DISPLAY_NAME} push notifications are working`,
        expectedSource: 'TEST'
      }
    ]

    for (const [index, testCase] of cases.entries()) {
      await expect(client.send(testCase.event)).resolves.toEqual({ accepted: true })
      const body = JSON.parse(String(fetchImpl.mock.calls[index]?.[1].body))
      expect(body).toMatchObject({
        title: APP_DISPLAY_NAME,
        body: testCase.expectedBody,
        source: testCase.expectedSource,
        runtimeId
      })
      expect(body.agentState).toBe(testCase.expectedAgentState)
    }
  })
})
