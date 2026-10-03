import { describe, expect, it } from 'vitest'
import type { RuntimeEnvironmentStatus } from '@/store/slices/runtime-status-types'
import { getDesktopHomeWebLaunchIssue } from './desktop-home-web-launch'

const connected: RuntimeEnvironmentStatus = {
  checkedAt: 1,
  status: {
    runtimeId: 'host-a',
    rendererGraphEpoch: 0,
    graphStatus: 'ready',
    authoritativeWindowId: null,
    liveTabCount: 0,
    liveLeafCount: 0
  }
}

describe('Web home task owner', () => {
  it.each([undefined, 'local', 'ssh:server'])('rejects unpaired owner %s', (owner) => {
    expect(getDesktopHomeWebLaunchIssue(owner, new Map())).toContain('Select a connected Host')
  })

  it('allows the selected connected Host, independent of other disconnected Hosts', () => {
    const statuses = new Map([
      ['host-a', connected],
      ['host-b', { checkedAt: 1, status: null }]
    ])
    expect(getDesktopHomeWebLaunchIssue('runtime:host-a', statuses)).toBeNull()
    expect(getDesktopHomeWebLaunchIssue('runtime:host-b', statuses)).toContain('unavailable')
    expect(getDesktopHomeWebLaunchIssue('runtime:missing', statuses)).toContain('unavailable')
  })
})
