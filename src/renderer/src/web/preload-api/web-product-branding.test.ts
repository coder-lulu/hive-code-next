// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME, PRIMARY_CLI_COMMAND } from '@/product-brand'
import { createAgentHooksApi } from './web-agent-hooks-api'
import { createWebAppApi } from './web-app-api'
import { createCliApi } from './web-cli-api'
import { createWebOrcaProfilesApi } from './web-orca-profiles-api'

describe('web fallback product branding', () => {
  it('uses HiveCode identity and the primary CLI command on visible fallback surfaces', async () => {
    const identity = await createWebAppApi().app!.getIdentity()
    const cliStatus = await createCliApi().getInstallStatus()
    const hookStatus = await createAgentHooksApi().codexStatus()
    const profileAuth = await createWebOrcaProfilesApi().orcaProfiles!.authStatus()

    expect(identity.name).toBe(APP_DISPLAY_NAME)
    expect(cliStatus.commandName).toBe(PRIMARY_CLI_COMMAND)
    expect(cliStatus.detail).toContain(APP_DISPLAY_NAME)
    expect(hookStatus.detail).toContain(APP_DISPLAY_NAME)
    expect(profileAuth.setupMessage).toContain(APP_DISPLAY_NAME)
    expect(JSON.stringify({ identity, cliStatus, hookStatus, profileAuth })).not.toMatch(/\bOrca\b/)
  })
})
