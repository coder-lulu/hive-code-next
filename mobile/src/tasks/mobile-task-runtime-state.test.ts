import { describe, expect, it } from 'vitest'
import type { ConnectionState } from '../transport/types'
import { resolveMobileTaskRuntimeState } from './mobile-task-runtime-state'

describe('mobile task Runtime state', () => {
  it('resolves terminal connection failures instead of leaving an indefinite loading state', () => {
    expect(
      resolveMobileTaskRuntimeState({
        connectionState: 'auth-failed',
        tasksSupported: false,
        tasksUnsupported: false
      })
    ).toBe('auth-failed')
    expect(
      resolveMobileTaskRuntimeState({
        connectionState: 'disconnected',
        tasksSupported: false,
        tasksUnsupported: false
      })
    ).toBe('disconnected')
  })

  it('only reports offline with cloud evidence, not a disconnected RPC', () => {
    const input = {
      connectionState: 'disconnected' as const,
      tasksSupported: false,
      tasksUnsupported: false
    }
    expect(resolveMobileTaskRuntimeState({ ...input, accountPresence: 'ONLINE' })).toBe(
      'disconnected'
    )
    expect(resolveMobileTaskRuntimeState({ ...input, accountPresence: 'OFFLINE' })).toBe('offline')
    expect(
      resolveMobileTaskRuntimeState({
        ...input,
        accountPresence: 'ONLINE',
        credentialStatus: 'cloud-unavailable'
      })
    ).toBe('unavailable')
    expect(resolveMobileTaskRuntimeState({ ...input, catalogLoading: true })).toBe('loading')
  })

  it('does not allow cached capabilities to hide a lost or rejected connection', () => {
    expect(
      resolveMobileTaskRuntimeState({
        connectionState: 'disconnected',
        tasksSupported: true,
        tasksUnsupported: false
      })
    ).toBe('disconnected')
    expect(
      resolveMobileTaskRuntimeState({
        connectionState: 'auth-failed',
        tasksSupported: true,
        tasksUnsupported: false
      })
    ).toBe('auth-failed')
  })

  it.each([
    ['missing', 'auth-failed'],
    ['temporarily-unavailable', 'unavailable'],
    ['cloud-offline', 'offline'],
    ['ready', 'disconnected']
  ] as const)(
    'handles %s credentials without inventing a live connection',
    (credentialStatus, expected) => {
      expect(
        resolveMobileTaskRuntimeState({
          connectionState: 'disconnected',
          tasksSupported: false,
          tasksUnsupported: false,
          credentialStatus
        })
      ).toBe(expected)
    }
  )

  it('uses verified RPC capability ahead of stale cloud presence', () => {
    expect(
      resolveMobileTaskRuntimeState({
        connectionState: 'connected',
        tasksSupported: true,
        tasksUnsupported: false,
        accountPresence: 'OFFLINE'
      })
    ).toBe('ready')
  })

  it.each<ConnectionState>(['connecting', 'handshaking', 'reconnecting', 'connected'])(
    'keeps %s in loading while capability discovery is unsettled',
    (connectionState) => {
      expect(
        resolveMobileTaskRuntimeState({
          connectionState,
          tasksSupported: false,
          tasksUnsupported: false
        })
      ).toBe('loading')
    }
  )

  it('gives settled capability results precedence', () => {
    expect(
      resolveMobileTaskRuntimeState({
        connectionState: 'connected',
        tasksSupported: true,
        tasksUnsupported: false
      })
    ).toBe('ready')
    expect(
      resolveMobileTaskRuntimeState({
        connectionState: 'connected',
        tasksSupported: false,
        tasksUnsupported: true
      })
    ).toBe('unsupported')
  })
})
