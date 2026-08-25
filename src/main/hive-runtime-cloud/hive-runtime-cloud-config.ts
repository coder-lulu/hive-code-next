import { getHiveAccountConfig } from '../hive-account/hive-account-config'

export type HiveRuntimeCloudConfig = { enabled: false } | { enabled: true; apiBaseUrl: string }

function enabled(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}
export function getHiveRuntimeCloudConfig(
  env: NodeJS.ProcessEnv = process.env
): HiveRuntimeCloudConfig {
  if (!enabled(env.HIVECODE_RUNTIME_CLOUD_PRESENCE_ENABLED)) {
    return { enabled: false }
  }
  const account = getHiveAccountConfig(env)
  return account.configured
    ? { enabled: true, apiBaseUrl: account.config.apiBaseUrl }
    : { enabled: false }
}
