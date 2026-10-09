import {
  claudeProviderHandle,
  codexProviderHandle
} from '../../shared/agent-session-provider-handle-encoding'

export const externalProviderHandle = (provider: 'codex' | 'claude') =>
  provider === 'codex'
    ? codexProviderHandle('external-thread')
    : claudeProviderHandle('external-session', null)
