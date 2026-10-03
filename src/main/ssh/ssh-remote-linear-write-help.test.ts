import { describe, expect, it } from 'vitest'

import { getRemoteLinearWriteHelp } from './ssh-remote-linear-write-help'

describe('SSH remote Linear write help branding', () => {
  it.each([
    ['save issue', ['linear', 'save-issue']],
    ['relation add', ['linear', 'relation', 'add']],
    ['status set', ['linear', 'status', 'set']],
    ['comment add', ['linear', 'comment', 'add']],
    ['create', ['linear', 'create']]
  ])('uses the primary command for %s', (_name, commandPath) => {
    const help = getRemoteLinearWriteHelp({ commandPath, flags: new Map() })

    expect(help).toContain('hive linear')
    expect(help).not.toMatch(/(^|\s)orca linear/m)
  })
})
