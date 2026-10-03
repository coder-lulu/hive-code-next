import { expect, it } from 'vitest'
import { RUNTIME_CAPABILITIES } from './protocol-version'

it('does not advertise desktop registerPush capability for account-level HiveCloud push', () => {
  expect(RUNTIME_CAPABILITIES).not.toContain('notifications.remote-push.v1')
})
