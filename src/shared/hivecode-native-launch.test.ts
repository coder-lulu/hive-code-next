import { describe, expect, it } from 'vitest'
import { buildAgentStartupPlan, buildAgentResumeStartupPlan } from './tui-agent-startup'
import { agentProviderSessionsEqual } from './agent-session-resume'
import { resolvePaneAgentOwner } from './pane-agent-owner'
import { getAgentModelProbeSpec } from './agent-model-probe-spec'
import { getAgentSessionOptionCatalog } from './agent-session-option-catalog'

describe('HiveCode native Pi launch', () => {
  it.each([
    ['win32', 'hive.cmd'],
    ['darwin', 'hive'],
    ['linux', 'hive']
  ] as const)('launches a real native command on %s', (platform, binary) => {
    const plan = buildAgentStartupPlan({
      agent: 'hivecode',
      prompt: 'fix tests',
      cmdOverrides: {},
      platform
    })
    expect(plan?.launchCommand).toContain(`${binary} hive-ai`)
    expect(plan?.launchCommand).toContain('fix tests')
    expect(plan?.expectedProcess).toBe('pi')
  })
  it('resumes the Pi session file through the authenticated wrapper', () => {
    const providerSession = {
      key: 'session_id' as const,
      id: 'session',
      transcriptPath: '/tmp/pi session.jsonl'
    }
    const plan = buildAgentResumeStartupPlan({
      agent: 'hivecode',
      providerSession,
      cmdOverrides: {},
      platform: 'linux'
    })
    expect(plan?.launchCommand).toBe("hive hive-ai '--session' '/tmp/pi session.jsonl'")
    expect(
      agentProviderSessionsEqual('hivecode', providerSession, {
        ...providerSession,
        transcriptPath: '/other.jsonl'
      })
    ).toBe(false)
    expect(
      buildAgentResumeStartupPlan({
        agent: 'hivecode',
        providerSession: { key: 'session_id', id: 'missing-file' },
        cmdOverrides: {},
        platform: 'linux'
      })
    ).toBeNull()
  })
  it('discovers only Hive models and switches through the native Pi command', () => {
    const spec = getAgentModelProbeSpec('hivecode')!
    expect(spec.modelDiscovery?.args).toEqual(['hive-ai', '--list-models'])
    expect(
      spec.modelDiscovery?.parse(
        JSON.stringify({
          models: [{ selector: 'hivecode/test', id: 'test', provider: 'hivecode', name: 'Test' }]
        })
      )
    ).toEqual([{ id: 'hivecode/test', label: 'Test', description: 'hivecode' }])
    const catalog = getAgentSessionOptionCatalog('hivecode')!
    expect(catalog.models).toEqual([])
    expect(catalog.unknownModelOptions).toBeUndefined()
    expect(
      catalog.listModels
        ?.parse(
          JSON.stringify({
            models: [{ selector: 'hivecode/test', id: 'test', provider: 'hivecode' }]
          })
        )
        .map((model) => model.options)
    ).toEqual([[]])
    const apply = catalog.modelApply.midSession
    expect(apply?.kind === 'command' && apply.build('hivecode/test')).toBe('/model hivecode/test')
  })
  it('retains the HiveCode owner when Pi emits its status', () => {
    expect(resolvePaneAgentOwner({ launchAgent: 'hivecode', hookAgent: 'pi' })).toBe('hivecode')
  })
})
