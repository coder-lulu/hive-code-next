import { describe, expect, it } from 'vitest'
import { buildAgentDraftLaunchPlan } from './tui-agent-startup'

describe('draft prefill teardown ordering (#14975)', () => {
  // Why pinned: the teardown mutates the calling shell, so it must reference
  // $fish_pid, which aborts the line under `set -u`. That is survivable ONLY
  // because it runs AFTER the agent — the agent is already up. Moving it before
  // the command would make an aborted line a blocked launch, which is exactly
  // what reverted #14863.
  it('runs the clear after the agent command, never before it', () => {
    const plan = buildAgentDraftLaunchPlan({
      agent: 'pi',
      draft: 'hello',
      cmdOverrides: {},
      platform: 'darwin'
    })

    const command = plan?.launchCommand ?? ''
    expect(command.indexOf('pi')).toBeLessThan(command.indexOf('fish_pid'))
    expect(command).toMatch(/^pi;/)
  })
})
