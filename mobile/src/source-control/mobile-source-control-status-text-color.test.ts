import { describe, expect, it, vi } from 'vitest'
import { darkTheme, lightTheme } from '../theme/mobile-theme'
import { statusTextColor } from './mobile-source-control-screen-state'

vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ArrowDownUp: 'ArrowDownUp',
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  CloudUpload: 'CloudUpload',
  GitBranch: 'GitBranch',
  GitPullRequestArrow: 'GitPullRequestArrow',
  History: 'History',
  RefreshCw: 'RefreshCw'
}))

describe('statusTextColor', () => {
  it.each([lightTheme, darkTheme])('uses contrast-safe semantic text tokens', (theme) => {
    expect(statusTextColor('added', theme)).toBe(theme.color.status.successText)
    expect(statusTextColor('copied', theme)).toBe(theme.color.status.successText)
    expect(statusTextColor('deleted', theme)).toBe(theme.color.status.dangerText)
    expect(statusTextColor('untracked', theme)).toBe(theme.color.status.warningText)
    expect(statusTextColor('modified', theme)).toBe(theme.color.text.secondary)
  })
})
