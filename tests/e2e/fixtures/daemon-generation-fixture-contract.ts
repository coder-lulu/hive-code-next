export const DAEMON_GENERATION_WORKTREE_ID = 'fixture-worktree'

export type LegacyCloseFixtureSession = {
  protocolVersion: number
  sessionId: string
  rootPid: number
  worktreeId: string
  tabId: string
  closeContract: 'capable' | 'legacy'
}

export type LegacyCloseFixtureConfig = {
  generations: { protocolVersion: number; socketPath: string; tokenPath: string }[]
  currentProtocolVersion: number
  daemonDir: string
  historyDir: string
  cwd: string
  sessions: LegacyCloseFixtureSession[]
}
