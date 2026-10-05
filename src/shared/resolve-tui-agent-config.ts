import type { TuiAgentConfig } from './tui-agent-config-types'

/** Authoring form: launch and process identities default to the detected executable. */
export type TuiAgentConfigSource = Omit<TuiAgentConfig, 'launchCmd' | 'expectedProcess'> & {
  launchCmd?: string
  expectedProcess?: string
}

export function resolveTuiAgentConfig(source: TuiAgentConfigSource): TuiAgentConfig {
  return {
    ...source,
    launchCmd: source.launchCmd ?? source.detectCmd,
    expectedProcess: source.expectedProcess ?? source.detectCmd
  }
}
