import { z } from 'zod'
import type { TuiAgent } from '../tui-agent'
import { isTuiAgent } from '../tui-agent-config'

export const PreflightCheck = z.object({
  force: z.boolean().optional()
})

export const PreflightDetectRemoteAgents = z.object({
  connectionId: z.string().min(1)
})

export const PreflightDetectRemoteWindowsTerminalCapabilities = z.object({
  connectionId: z.string().min(1)
})

const AgentVersionAgent = z.custom<TuiAgent>(isTuiAgent, { message: 'Unknown agent preset' })

export const PreflightReadAgentVersion = z
  .object({
    agent: AgentVersionAgent,
    commandOverride: z.string().max(4096).optional(),
    wslDistro: z.string().trim().min(1).max(256).nullable().optional()
  })
  .strict()

export const PreflightReadLatestAgentVersion = z
  .object({ agent: AgentVersionAgent, registry: z.enum(['default', 'china']).optional() })
  .strict()

export const PreflightInstallAgent = z
  .object({
    agent: AgentVersionAgent,
    action: z.enum(['install', 'upgrade']).default('install'),
    registry: z.enum(['default', 'china']).default('default'),
    commandOverride: z.string().max(4096).optional(),
    expectedRealPath: z.string().min(1).max(4096).optional(),
    wslDistro: z.string().trim().min(1).max(256).nullable().optional()
  })
  .strict()
