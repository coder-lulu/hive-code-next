// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentSkillSetupStatus } from './AgentSkillSetupStatus'

describe('AgentSkillSetupStatus', () => {
  it('reports a failed first skill check as unavailable, while retaining an installation failure', () => {
    const readFailure = renderToStaticMarkup(
      <AgentSkillSetupStatus
        failedExitCode={null}
        loading={false}
        installed={false}
        error="The skill location could not be scanned"
        installDisabled={false}
      />
    )
    expect(readFailure).toContain('Check failed')
    expect(readFailure).not.toContain('Not installed')

    const unavailableRuntime = renderToStaticMarkup(
      <AgentSkillSetupStatus
        failedExitCode={null}
        loading={false}
        installed={false}
        error="The selected runtime cannot install this skill"
        installDisabled
      />
    )
    expect(unavailableRuntime).toContain('Unavailable')

    const installFailure = renderToStaticMarkup(
      <AgentSkillSetupStatus
        failedExitCode={1}
        loading={false}
        installed={false}
        error="The skill location could not be scanned"
        installDisabled={false}
      />
    )
    expect(installFailure).toContain('Setup failed')
    expect(installFailure).not.toContain('Not installed')

    const staleInstalledReadFailure = renderToStaticMarkup(
      <AgentSkillSetupStatus
        failedExitCode={null}
        loading={false}
        installed
        error="A skill source could not be scanned"
        installDisabled={false}
      />
    )
    expect(staleInstalledReadFailure).toContain('Check failed')
    expect(staleInstalledReadFailure).not.toContain('Installed')
  })
})
