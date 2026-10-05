import { describe, expect, it, vi } from 'vitest'
import { getHostListActionSheetActions } from './host-list-action-sheet-actions'
import type { ConnectionState, HostCatalogEntry, HostProfile } from './transport/types'

vi.mock('lucide-react-native', () => ({
  Activity: vi.fn(),
  Edit3: vi.fn(),
  PowerOff: vi.fn(),
  RefreshCw: vi.fn(),
  Users: vi.fn()
}))

const PROFILE: HostProfile = {
  id: 'host-1',
  name: 'Host 1',
  endpoint: 'ws://192.168.21.4:6768',
  deviceToken: 'token',
  publicKeyB64: 'key',
  lastConnected: 0
}
const HOST: HostCatalogEntry = { ...PROFILE, credentialStatus: 'ready', profile: PROFILE }

function build(
  overrides: { host?: HostCatalogEntry; state?: ConnectionState; hasEverConnected?: boolean } = {}
) {
  const spies = {
    onDismiss: vi.fn(),
    onReconnect: vi.fn(),
    onDisconnect: vi.fn(),
    onDiagnostics: vi.fn(),
    onEdit: vi.fn(),
    onSessions: vi.fn(),
    onRemove: vi.fn()
  }
  const actions = getHostListActionSheetActions({
    host: overrides.host ?? HOST,
    state: overrides.state ?? 'connected',
    hasEverConnected: overrides.hasEverConnected ?? true,
    ...spies
  })
  return { actions, spies }
}

describe('getHostListActionSheetActions', () => {
  it('offers cloud alias and scoped sessions for an account Runtime without local removal', () => {
    const { actions, spies } = build({
      host: {
        ...HOST,
        runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        accessSources: ['account-claimed']
      }
    })
    expect(actions.map((action) => action.label)).toEqual([
      '重新连接',
      '断开当前手机连接',
      '网络诊断',
      '修改云端别名',
      '会话管理'
    ])
    for (const label of ['修改云端别名', '会话管理']) {
      const action = actions.find((entry) => entry.label === label)!
      expect(action.closeBeforePress).toBe(true)
      action.onPress()
    }
    expect(spies.onEdit).toHaveBeenCalledWith(HOST.id)
    expect(spies.onSessions).toHaveBeenCalledWith(HOST.id)
    expect(spies.onRemove).not.toHaveBeenCalled()
  })

  it('keeps cloud alias and sessions available when the Runtime has no connectable profile', () => {
    const { actions } = build({
      host: {
        ...HOST,
        runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        accessSources: ['account-claimed'],
        profile: null,
        credentialStatus: 'cloud-offline'
      },
      state: 'disconnected'
    })
    expect(actions.find((action) => action.label === '连接')).toMatchObject({
      disabled: true,
      hint: expect.any(String)
    })
    expect(actions.find((action) => action.label === '网络诊断')?.disabled).toBe(true)
    expect(actions.find((action) => action.label === '修改云端别名')?.disabled).not.toBe(true)
    expect(actions.find((action) => action.label === '会话管理')?.disabled).toBe(false)
    expect(actions.some((action) => action.label === '断开当前手机连接')).toBe(false)
  })
  // Why: these navigate or open a second drawer. Presenting while this sheet's native
  // Modal is still up freezes the whole screen on iOS — issue #8791.
  it.each(['网络诊断', '修改别名与连接地址', '移除本地配对'])(
    'defers %s until the action sheet has closed',
    (label) => {
      const { actions } = build()
      expect(actions.find((action) => action.label === label)).toMatchObject({
        closeBeforePress: true
      })
    }
  )

  it('leaves the in-place actions undeferred so they fire on tap', () => {
    const { actions, spies } = build()
    const disconnect = actions.find((action) => action.label === '断开当前手机连接')
    expect(disconnect?.closeBeforePress).toBeUndefined()
    disconnect?.onPress()
    expect(spies.onDisconnect).toHaveBeenCalledWith(HOST.id)
    expect(spies.onDismiss).toHaveBeenCalled()
  })

  it('hands Remove the whole host so the confirm sheet can name it', () => {
    const { actions, spies } = build()
    actions.find((action) => action.label === '移除本地配对')?.onPress()
    expect(spies.onRemove).toHaveBeenCalledWith(HOST)
  })

  it('routes Edit host to the edit screen', () => {
    const { actions, spies } = build()
    actions.find((action) => action.label === '修改别名与连接地址')?.onPress()
    expect(spies.onEdit).toHaveBeenCalledWith(HOST.id)
  })

  it('routes Network diagnostics with the selected host', () => {
    const { actions, spies } = build()
    actions.find((action) => action.label === '网络诊断')?.onPress()
    expect(spies.onDiagnostics).toHaveBeenCalledWith(HOST.id)
  })

  it('offers Disconnect only while the socket is live', () => {
    expect(build({ state: 'reconnecting' }).actions.map((action) => action.label)).toEqual([
      '重新连接',
      '断开当前手机连接',
      '网络诊断',
      '修改别名与连接地址',
      '移除本地配对'
    ])
    expect(build({ state: 'disconnected' }).actions.map((action) => action.label)).toEqual([
      '连接',
      '网络诊断',
      '修改别名与连接地址',
      '移除本地配对'
    ])
  })

  it('says Connect until the host has connected at least once this session', () => {
    expect(build({ hasEverConnected: false }).actions[0]?.label).toBe('连接')
    expect(build({ hasEverConnected: true }).actions[0]?.label).toBe('重新连接')
  })

  it('renders nothing without a target host', () => {
    expect(
      getHostListActionSheetActions({
        host: null,
        state: 'disconnected',
        hasEverConnected: false,
        onDismiss: vi.fn(),
        onReconnect: vi.fn(),
        onDisconnect: vi.fn(),
        onDiagnostics: vi.fn(),
        onEdit: vi.fn(),
        onRemove: vi.fn()
      })
    ).toEqual([])
  })
})
