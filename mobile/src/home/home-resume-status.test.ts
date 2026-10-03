import { describe, expect, it } from 'vitest'
import type { HomeResumeCard } from '../worktree/home-resume-card'
import { homeResumeStatus } from './home-resume-status'

function card(status: HomeResumeCard['worktree']['status'], actionable = true): HomeResumeCard {
  return {
    actionable,
    hostId: 'host',
    worktree: {
      branch: 'main',
      displayName: 'workspace',
      liveTerminalCount: 0,
      repo: 'repo',
      status,
      worktreeId: 'workspace'
    }
  }
}

describe('home resume status', () => {
  it('preserves actionable workspace state semantics', () => {
    expect(homeResumeStatus(card('working'))).toEqual({ label: '运行中', tone: 'brand' })
    expect(homeResumeStatus(card('permission'))).toEqual({ label: '等待确认', tone: 'warning' })
    expect(homeResumeStatus(card('done'))).toEqual({ label: '已完成', tone: 'success' })
    expect(homeResumeStatus(card('inactive'))).toEqual({ label: '等待输入', tone: 'neutral' })
  })

  it('reports lost runtime contact as unverifiable rather than failed', () => {
    expect(homeResumeStatus(card('working', false))).toEqual({
      label: '不可验证',
      tone: 'neutral'
    })
  })
})
