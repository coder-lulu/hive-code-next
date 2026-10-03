import type { AgentVersionRequest } from './agent-version-types'

export type AgentInstallationRequest = AgentVersionRequest

export type AgentInstallationSource =
  | 'npm'
  | 'homebrew-formula'
  | 'homebrew-cask'
  | 'self-update'
  | 'bun'
  | 'uv'
  | 'binary'
  | 'unknown'

export type AgentInstallation = {
  path: string
  command: string
  realPath: string
  version: string | null
  health: 'ready' | 'broken'
  source: AgentInstallationSource
  isActive: boolean
  isDefault: boolean
  canUpgrade: boolean
  reason?: string
}

export type AgentInstallationReport = {
  status: 'ready' | 'unsupported' | 'error'
  installations: AgentInstallation[]
  conflict: boolean
  truncated: boolean
  reason?: string
}
