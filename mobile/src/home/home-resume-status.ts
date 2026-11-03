import { translate } from '../i18n/mobile-i18n'
import type { HomeResumeCard } from '../worktree/home-resume-card'

export type HomeResumeTone = 'brand' | 'success' | 'warning' | 'neutral'

export function homeResumeStatus(card: HomeResumeCard): {
  readonly label: string
  readonly tone: HomeResumeTone
} {
  if (!card.actionable) {
    return {
      label: translate('auto.mobile.src.home.home.resume.status.385cc8cabd', 'Unverifiable'),
      tone: 'neutral'
    }
  }
  switch (card.worktree.status) {
    case 'working':
    case 'active':
      return { label: translate('chat.nativeChatToolLine.running', 'Running'), tone: 'brand' }
    case 'permission':
      return {
        label: translate(
          'auto.mobile.src.home.home.resume.status.6dbece50d1',
          'Waiting for confirmation'
        ),
        tone: 'warning'
      }
    case 'done':
      return { label: translate('chat.taskList.completed', 'Completed'), tone: 'success' }
    case 'inactive':
    case undefined:
      return {
        label: translate('worktree.agentRowDisplay.waiting', 'Waiting for input'),
        tone: 'neutral'
      }
  }
}
