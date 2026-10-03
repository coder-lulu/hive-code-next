export type AgentNpmRegistry = 'default' | 'china'

export const AGENT_NPM_REGISTRIES: Record<AgentNpmRegistry, string> = {
  default: 'https://registry.npmjs.org',
  china: 'https://registry.npmmirror.com'
}

export function normalizeAgentNpmRegistry(value: unknown): AgentNpmRegistry {
  return value === 'china' ? 'china' : 'default'
}

export function withAgentNpmRegistry(
  env: NodeJS.ProcessEnv,
  registry?: AgentNpmRegistry
): NodeJS.ProcessEnv {
  const result = { ...env }
  for (const key of Object.keys(result)) {
    if (
      key.toLowerCase() === 'npm_config_registry' ||
      key.toLowerCase() === 'bun_config_registry'
    ) {
      delete result[key]
    }
  }
  const source = AGENT_NPM_REGISTRIES[registry ?? 'default']
  return { ...result, npm_config_registry: source, BUN_CONFIG_REGISTRY: source }
}
