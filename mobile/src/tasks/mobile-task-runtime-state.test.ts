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
    ).toBe('offline')
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
