// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  useAgentPermissionOverrideNotice,
  type SelectPermissionOverrides
} from './agent-permission-override-notice'
const notifications = vi.hoisted(() => ({ success: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast: notifications }))
vi.mock('@/lib/agent-catalog', () => ({ getAgentLabel: (agent: string) => agent }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, text: string) => text }))
vi.mock('../native-chat/native-chat-permission-mode-labels', () => ({
  nativeChatPermissionModeLabel: (mode: string) => mode
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('offers follow-default for retained scoped overrides and excludes concurrently changed choices', () => {
  const { result } = renderHook(() => useAgentPermissionOverrideNotice())
  const before = {
    default: 'own' as const,
    overrides: { claude: 'full-access' as const, codex: 'ask' as const }
  }
  const after = { ...before, default: 'ask' as const }
  const follow = vi.fn(async (select: SelectPermissionOverrides) => {
    expect(select(after)).toEqual(['claude'])
    expect(select({ ...after, overrides: { ...after.overrides, claude: 'own' } })).toEqual([])
    expect(select({ ...after, default: 'auto' })).toEqual([])
  })
  act(() => result.current(before, after, { type: 'permissions', mode: 'ask' }, follow))
  expect(notifications.success).toHaveBeenCalledTimes(1)
  act(() => notifications.success.mock.calls[0][1].action.onClick())
  expect(follow).toHaveBeenCalledTimes(1)
})
it('does not treat an explicit scoped reset as a global choice change', () => {
  const { result } = renderHook(() => useAgentPermissionOverrideNotice())
  const before = { default: 'ask' as const, overrides: { claude: 'full-access' as const } }
  act(() =>
    result.current(
      before,
      { ...before, overrides: {} },
      { type: 'permissions', agent: 'claude', mode: 'default' },
      vi.fn()
    )
  )
  expect(notifications.success).not.toHaveBeenCalled()
})
