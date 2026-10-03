import { describe, expect, it } from 'vitest'
import {
  buildLocalNotificationData,
  getNotificationNavigationTarget,
  notificationCredentialRecoveryRoute
} from './notification-routing'

describe('notification routing', () => {
  it('keeps the shared delivery id in local notification data', () => {
    expect(
      buildLocalNotificationData(
        {
          source: 'agent-task-complete',
          deliveryId: '22222222-2222-4222-8222-222222222222'
        },
        'host-1'
      )
    ).toMatchObject({
      hostId: 'host-1',
      deliveryId: '22222222-2222-4222-8222-222222222222'
    })
  })

  // Identities stay raw: the target is dispatched as navigator params, not a URL.
  it('routes notification taps to the worktree terminal screen', () => {
    expect(
      getNotificationNavigationTarget({
        hostId: 'host-1',
        worktreeId: 'repo::/Users/me/orca/workspaces/feature'
      })
    ).toEqual({
      hostId: 'host-1',
      sessionTarget: {
        name: '[hostId]/session/[worktreeId]',
        params: { hostId: 'host-1', worktreeId: 'repo::/Users/me/orca/workspaces/feature' }
      }
    })
  })

  it('falls back to the host screen when the payload has no worktree id', () => {
    expect(getNotificationNavigationTarget({ hostId: 'host-1' })).toEqual({
      hostId: 'host-1',
      sessionTarget: null
    })
  })

  it('routes a HiveCloud native payload by runtime id without exposing workspace data', () => {
    expect(
      getNotificationNavigationTarget(
        { runtimeId: 'runtime-1', notificationId: 'notification-1', source: 'TEST' },
        { knownHostIds: new Set(['runtime-1']) }
      )
    ).toEqual({ hostId: 'runtime-1', sessionTarget: null })
  })

  it('maps a claimed runtime id to its locally paired host and credential state', () => {
    expect(
      getNotificationNavigationTarget(
        { runtimeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        {
          knownHostIds: new Set(['local-host']),
          hostIdByRuntimeId: new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'local-host']]),
          credentialStatusByHostId: new Map([['local-host', 'missing']])
        }
      )
    ).toEqual({ hostId: 'local-host', sessionTarget: null, credentialRecovery: 're-pair' })
  })

  it('ignores payloads that cannot identify the paired host', () => {
    expect(getNotificationNavigationTarget({ worktreeId: 'repo::/tmp/worktree' })).toBeNull()
  })

  it('ignores payloads for hosts that are no longer paired', () => {
    expect(
      getNotificationNavigationTarget(
        { hostId: 'removed-host', worktreeId: 'repo::/tmp/worktree' },
        { knownHostIds: new Set(['host-1']) }
      )
    ).toBeNull()
  })

  it.each([
    ['missing', 're-pair'],
    ['temporarily-unavailable', 'retry']
  ] as const)('routes %s host credentials to %s recovery', (status, recovery) => {
    const target = getNotificationNavigationTarget(
      { hostId: 'host-1', worktreeId: 'repo::/tmp/worktree' },
      {
        knownHostIds: new Set(['host-1']),
        credentialStatusByHostId: new Map([['host-1', status]])
      }
    )

    expect(target).toMatchObject({ hostId: 'host-1', credentialRecovery: recovery })
    expect(notificationCredentialRecoveryRoute(target!)).toBe(
      status === 'missing' ? '/pair-scan' : '/'
    )
  })

  it('keeps ready hosts on the requested notification destination', () => {
    const target = getNotificationNavigationTarget(
      { hostId: 'host-1', worktreeId: 'repo::/tmp/worktree' },
      { credentialStatusByHostId: new Map([['host-1', 'ready']]) }
    )

    expect(target?.sessionTarget).not.toBeNull()
    expect(notificationCredentialRecoveryRoute(target!)).toBeNull()
  })
})

it('preserves the originating pane in the workspace route', () => {
  const paneKey = 'tab-b:11111111-1111-4111-8111-111111111111'
  expect(
    getNotificationNavigationTarget({ hostId: 'host', worktreeId: 'folder:/work', paneKey })
      ?.sessionTarget?.params
  ).toEqual({ hostId: 'host', worktreeId: 'folder:/work', paneKey })
})
