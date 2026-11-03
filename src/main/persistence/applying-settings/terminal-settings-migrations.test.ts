import { describe, expect, it } from 'vitest'
import { expandWorkspaceDirHome } from './terminal-settings-migrations'

describe('current terminal settings migration', () => {
  it('expands workspace home without injecting arguments or environment for other agents', () => {
    const migrated = expandWorkspaceDirHome({
      workspaceDir: '~/workspaces',
      agentDefaultArgs: { claude: '--dangerously-skip-permissions' },
      agentDefaultEnv: {}
    })
    expect(migrated.agentDefaultArgs).toEqual({ claude: '--dangerously-skip-permissions' })
    expect(migrated.agentDefaultEnv).toEqual({})
    expect(migrated.workspaceDir).not.toBe('~/workspaces')
  })

  it('keeps explicit Devin arguments literal', () => {
    const migrated = expandWorkspaceDirHome({
      workspaceDir: '~/workspaces',
      agentDefaultArgs: { devin: '--permission-mode bypass' }
    })
    expect(migrated.agentDefaultArgs?.devin).toBe('--permission-mode bypass')
  })

  it('does not rewrite an explicit workspace-trust argument during current settings migration', () => {
    const migrated = expandWorkspaceDirHome({
      workspaceDir: '~/workspaces',
      agentDefaultArgs: { devin: '--permission-mode bypass --respect-workspace-trust false' }
    })
    expect(migrated.agentDefaultArgs?.devin).toBe(
      '--permission-mode bypass --respect-workspace-trust false'
    )
  })
})
