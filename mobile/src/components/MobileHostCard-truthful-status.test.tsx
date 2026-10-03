import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionVerdict } from '../transport/connection-health'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type {
  ConnectionState,
  HostCatalogEntry,
  HostCredentialStatus,
  HostProfile
} from '../transport/types'
import {
  markHomeWorktreeCatalogUnavailable,
  type HostWorktreeInfo
} from '../worktree/home-worktree-info'
import { MobileHostCard } from './MobileHostCard'
import { lightTheme } from '../theme/mobile-theme'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({ Monitor: 'Monitor', MoreVertical: 'MoreVertical' }))
vi.mock('./StatusDot', () => ({ StatusDot: 'StatusDot' }))

const host: HostProfile = {
  id: 'host-1',
  name: 'Studio',
  endpoint: 'ws://studio.local:8765',
  deviceToken: 'token',
  publicKeyB64: 'key',
  lastConnected: 0
}
const verdict: ConnectionVerdict = { kind: 'normal', label: 'Connected' }
const loaded: HostWorktreeInfo = {
  hostId: 'host-1',
  totalWorktrees: 12,
  activeCount: 2,
  lastActiveWorktree: null,
  countsProvenAt: Date.now()
}

describe('MobileHostCard', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function renderCard(
    worktreeInfo: HostWorktreeInfo | undefined,
    overrides?: {
      state?: ConnectionState
      verdict?: ConnectionVerdict
      path?: MobileConnectionPath
      credentialStatus?: HostCredentialStatus
      host?: HostProfile | HostCatalogEntry
    }
  ): Promise<string[]> {
    await act(async () => {
      renderer = create(
        createElement(MobileHostCard, {
          theme: lightTheme,
          host: overrides?.host ?? host,
          state: overrides?.state ?? 'connected',
          verdict: overrides?.verdict ?? verdict,
          path: overrides?.path ?? 'lan',
          credentialStatus: overrides?.credentialStatus,
          worktreeInfo,
          onPress: () => {},
          onLongPress: () => {},
          onOpenActions: () => {}
        })
      )
    })
    return renderer!.root
      .findAllByType('Text')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
  }

  it('renders the counts the host proved', async () => {
    expect(await renderCard(loaded)).toContain('12 个工作区 · 2 个活跃')
  })

  it('keeps rendering the last proven counts after a failed refresh', async () => {
    // The regression this card shipped once: the caller dropped the counts the
    // failure path deliberately preserved.
    expect(await renderCard(markHomeWorktreeCatalogUnavailable(loaded, 'host-1'))).toContain(
      '上次状态：12 个工作区 · 2 个活跃'
    )
  })

  it('never asserts a count for a catalog that failed with nothing proven', async () => {
    expect(await renderCard(markHomeWorktreeCatalogUnavailable(undefined, 'host-1'))).toContain(
      '工作区列表不可用'
    )
  })

  it('names the relay while the dial is still in flight', async () => {
    const lines = await renderCard(undefined, {
      state: 'connecting',
      verdict: { kind: 'normal', label: 'Connecting via Relay…' },
      path: 'relay'
    })

    expect(lines).toContain('正在通过安全中继连接…')
    expect(lines).not.toContain(' · Orca 安全中继')
  })

  it('names the relay while a failed direct dial is still retrying', async () => {
    const lines = await renderCard(undefined, {
      state: 'reconnecting',
      verdict: { kind: 'normal', label: 'Connecting via Relay…' },
      path: 'relay'
    })

    expect(lines).toContain('正在通过安全中继连接…')
    expect(lines).not.toContain(' · Orca 安全中继')
  })

  it('leaves an idle disconnected host unlabelled', async () => {
    const lines = await renderCard(undefined, {
      state: 'disconnected',
      verdict: { kind: 'normal', label: 'Disconnected' },
      path: 'relay'
    })

    expect(lines).not.toContain(' · Orca 安全中继')
  })

  it('does not guess a direct path before the dial resolves', async () => {
    const lines = await renderCard(undefined, {
      state: 'connecting',
      verdict: { kind: 'normal', label: 'Connecting…' },
      path: 'lan'
    })

    expect(lines).not.toContain(' · 直连 · 局域网')
  })

  it('shows no worktree line before the first read lands', async () => {
    const lines = await renderCard(undefined)

    expect(lines).not.toContain('0 个工作区')
    expect(lines).not.toContain('工作区列表不可用')
  })

  it('offers re-pairing when the credential is missing', async () => {
    const lines = await renderCard(loaded, {
      state: 'connected',
      verdict: { kind: 'auth-failed', label: 'Pairing invalid' },
      credentialStatus: 'missing'
    })

    expect(lines).toContain('配对已失效')
    expect(lines).toContain('点击与桌面端重新配对')
    expect(lines).not.toContain('12 个工作区 · 2 个活跃')
  })

  it('offers a retry without declaring a transient read failure invalid', async () => {
    const lines = await renderCard(undefined, {
      state: 'disconnected',
      verdict: { kind: 'normal', label: 'Disconnected' },
      credentialStatus: 'temporarily-unavailable'
    })

    expect(lines).toContain('配对凭据暂时不可用')
    expect(lines).toContain('解锁手机后点击重试')
    expect(lines).not.toContain('配对已失效')
  })

  it.each(['temporarily-unavailable', 'cloud-offline', 'cloud-unavailable'] as const)(
    'keeps a proven live connection visible while directory status is %s',
    async (credentialStatus) => {
      const lines = await renderCard(loaded, {
        state: 'connected',
        verdict,
        credentialStatus
      })

      expect(lines).toContain('已连接')
      expect(lines).toContain(' · 直连 · 局域网')
      expect(lines).toContain('12 个工作区 · 2 个活跃')
      expect(lines).not.toContain('Runtime 离线')
      expect(lines).not.toContain('云连接暂不可用')
    }
  )

  it('shows account presence as online without claiming a phone connection', async () => {
    const lines = await renderCard(undefined, {
      state: 'disconnected',
      verdict: { kind: 'normal', label: 'Disconnected' },
      credentialStatus: 'ready',
      host: {
        ...host,
        credentialStatus: 'ready',
        profile: host,
        accessSources: ['account-claimed'],
        accountPresence: 'ONLINE'
      }
    })

    expect(lines).toContain('在线')
    expect(lines).not.toContain('未连接')
    expect(lines).not.toContain(' · 直连 · 局域网')
    expect(lines).not.toContain('12 个工作区 · 2 个活跃')
  })
})
