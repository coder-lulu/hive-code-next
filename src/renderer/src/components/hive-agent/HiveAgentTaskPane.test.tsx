// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ signedIn: true }))
vi.mock('@/hooks/use-hive-account-state', () => ({
  useHiveAccountState: () => ({
    state: mocks.signedIn
      ? { status: 'signed-in', account: { accountId: 'owner' } }
      : { status: 'signed-out' }
  })
}))
vi.mock('./HiveAgentConversation', () => ({
  hiveChatCopy: (_key: string, fallback: string) => fallback,
  HiveAgentConversation: ({ accountId }: { accountId: string }) => <div>{accountId}</div>
}))
import { HiveAgentTaskPane } from './HiveAgentTaskPane'
afterEach(() => {
  cleanup()
  mocks.signedIn = true
})
it('opens legacy history for the authenticated account', () => {
  render(<HiveAgentTaskPane tabId="tab" sessionId="old" worktreeId="folder" />)
  expect(screen.getByText('owner')).toBeTruthy()
})
it('does not mount history after sign-out', () => {
  mocks.signedIn = false
  render(<HiveAgentTaskPane tabId="tab" sessionId="old" worktreeId="folder" />)
  expect(screen.queryByText('owner')).toBeNull()
})
