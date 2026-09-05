import type { HomeResumeCard } from '../worktree/home-resume-card'

export type HomeResumeTone = 'brand' | 'success' | 'warning' | 'neutral'

export function homeResumeStatus(card: HomeResumeCard): {
  readonly label: string
  readonly tone: HomeResumeTone
} {
  if (!card.actionable) {
    return { label: '不可验证', tone: 'neutral' }
  }
  switch (card.worktree.status) {
    case 'working':
    case 'active':
      return { label: '运行中', tone: 'brand' }
    case 'permission':
      return { label: '等待确认', tone: 'warning' }
    case 'done':
      return { label: '已完成', tone: 'success' }
    case 'inactive':
    case undefined:
      return { label: '等待输入', tone: 'neutral' }
  }
}
