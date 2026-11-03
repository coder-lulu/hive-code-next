import { TUI_AGENT_AUTO_PICK_ORDER } from '../../../shared/tui-agent-selection'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ held: false, isWebClient: false }))

vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => mocks.isWebClient }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('./local-structured-session-tabs-sync/inventory-refresh', () => ({
  restoreLocalStructuredSessionTabsOnce: vi.fn(async () => undefined)
}))

import {
  resetLocalStructuredChatsForTests,
  localStructuredChatsInUse,
  restoreLocalStructuredChatsAtStartup
} from './local-structured-chats'

const SETTING_OFF = { nativeChatProviders: Object.fromEntries(TUI_AGENT_AUTO_PICK_ORDER.map(agent => [agent, false])) }
const SETTING_ON = { nativeChatProviders: {} }

beforeEach(() => {
  mocks.held = false
  mocks.isWebClient = false
  resetLocalStructuredChatsForTests()
  vi.stubGlobal('window', {
    api: {
      app: {
        holdsStructuredAgentSessions: async () => mocks.held,
        onStructuredAgentSessionsHeldChanged: () => () => undefined
      }
    }
  })
})

describe("startup's restore of this machine's structured chats", () => {
  it('waits for settings unless the host already holds chats, and cleans up after the last one', async () => {
    expect(await localStructuredChatsInUse(null)).toBe(false)
    expect(await localStructuredChatsInUse(undefined)).toBe(false)
    mocks.held = true
    expect(await localStructuredChatsInUse(null)).toBe(true)
    expect(await localStructuredChatsInUse(SETTING_OFF)).toBe(true)
    mocks.held = false
    expect(await localStructuredChatsInUse(SETTING_OFF)).toBe(false)
  })

  it('one provider remaining default-on keeps the local subscription in use', async () => {
    expect(await localStructuredChatsInUse({nativeChatProviders: {...SETTING_OFF.nativeChatProviders, pi: true}})).toBe(true)
  })
  it('runs no session-tab census when all defaults are false and no chat is held', async () => {
    const step = vi.fn(async () => undefined)

    await restoreLocalStructuredChatsAtStartup(SETTING_OFF, step)

    expect(step).not.toHaveBeenCalled()
  })

  // Existing chats come back whatever the setting says.
  it('restores the chats this machine holds with the setting off', async () => {
    mocks.held = true
    const step = vi.fn(async () => undefined)

    await restoreLocalStructuredChatsAtStartup(SETTING_OFF, step)

    expect(step).toHaveBeenCalledOnce()
  })

  it('restores when the setting launches structured chats', async () => {
    const step = vi.fn(async () => undefined)

    await restoreLocalStructuredChatsAtStartup(SETTING_ON, step)

    expect(step).toHaveBeenCalledOnce()
  })

  it('never restores in the browser client', async () => {
    mocks.isWebClient = true
    mocks.held = true
    const step = vi.fn(async () => undefined)

    await restoreLocalStructuredChatsAtStartup(SETTING_ON, step)

    expect(step).not.toHaveBeenCalled()
  })
})
