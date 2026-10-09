import { describe, expect, it } from 'vitest'
import { profileStateBuildCompatibilityError } from './profile-state-build-compatibility'

describe('SQLite profile build selection', () => {
  it.each(['1.4.221', '1.5.0-beta.23', '1.5.0-beta.24-adhoc.1', 'invalid'])(
    'refuses %s before it can read stale JSON',
    (version) => {
      expect(profileStateBuildCompatibilityError('1.5.0-beta.24', version)).toContain('SQLite profile baseline')
    }
  )

  it.each(['1.5.0-beta.24', '1.5.0-beta.25', '1.5.0'])(
    'allows SQLite-capable %s, including older builds',
    (version) => {
      expect(profileStateBuildCompatibilityError('1.5.0-beta.25', version)).toBeNull()
    }
  )

  it('refuses an unrecognized running version instead of authorizing a downgrade', () => {
    expect(profileStateBuildCompatibilityError('invalid', '1.5.0-beta.24')).toContain('SQLite profile baseline')
  })
})
