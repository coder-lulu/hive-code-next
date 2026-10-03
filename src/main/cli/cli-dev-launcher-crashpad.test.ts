import { expect, it } from 'vitest'
import { buildWindowsDevLauncher } from './cli-dev-launcher'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { getAgentModelProbeSpec } from '../../shared/agent-model-probe-spec'
import { getAgentSessionOptionCatalog } from '../../shared/agent-session-option-catalog'

it('clears stale inherited Crashpad registration before launching Electron Node CLI', () => {
  const script = buildWindowsDevLauncher(
    'C:/HiveCode/electron.exe',
    'C:/HiveCode/index.js',
    'C:/data'
  )
  expect(script.indexOf('set CHROME_CRASHPAD_PIPE_NAME=')).toBeLessThan(
    script.indexOf('"%ELECTRON%" "%CLI%"')
  )
  expect(script).not.toContain('2>')
})
it('launches and probes HiveCode AI through the current hive command', () => {
  expect(TUI_AGENT_CONFIG.hivecode.launchCmd).toBe('hive hive-ai')
  expect(TUI_AGENT_CONFIG.hivecode.launchCmdByPlatform?.win32).toBe('hive.cmd hive-ai')
  expect(getAgentModelProbeSpec('hivecode')?.modelDiscovery?.binary).toBe('hive')
  expect(getAgentSessionOptionCatalog('hivecode')?.listModels?.command).toBe(
    'hive hive-ai --list-models'
  )
})
