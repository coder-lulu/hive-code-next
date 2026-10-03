// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('./use-hive-agent-conversation', () => ({
  useHiveAgentConversation: () => ({
    timeline: { items: [], status: 'ready' },
    error: null
  })
}))
vi.mock('../native-chat/NativeChatMessageList', () => ({
  NativeChatMessageList: () => <div data-testid="history" />
}))
import { HiveAgentConversation } from './HiveAgentConversation'
afterEach(cleanup)
it('preserves legacy history without the retired composer or generation state controls', () => {
  render(
    <HiveAgentConversation tabId="tab" accountId="owner" sessionId="old" projectSelector="folder" />
  )
  expect(screen.getByTestId('history')).toBeTruthy()
  expect(screen.getByText(/read-only history/)).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
})
