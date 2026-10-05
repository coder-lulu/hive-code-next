import { describe, expect, it } from 'vitest'
import { findCommandSpec } from '../args'
import { formatCommandHelp } from '../help'
import { COMMAND_SPECS } from './index'
import { APP_DISPLAY_NAME } from '../../shared/brand'

function optionLine(path: string[], flag: string): string | undefined {
  const spec = findCommandSpec(COMMAND_SPECS, path)
  if (!spec) {
    throw new Error(`no spec for ${path.join(' ')}`)
  }
  return formatCommandHelp(spec)
    .split('\n')
    .find((line) => line.trimStart().startsWith(`--${flag} `))
}

describe('file command help', () => {
  it.each([['open'], ['diff'], ['open-changed']])(
    'file %s describes --focus as bringing the user to the file',
    (command) => {
      expect(optionLine(['file', command], 'focus')).toBe(
        `  --focus                Bring the user to the file (switches ${APP_DISPLAY_NAME}'s window to its worktree)`
      )
    }
  )

  it('leaves terminal create --focus describing its terminal session', () => {
    expect(optionLine(['terminal', 'create'], 'focus')).toBe(
      `  --focus                Reveal the created terminal session in ${APP_DISPLAY_NAME}`
    )
  })
})
