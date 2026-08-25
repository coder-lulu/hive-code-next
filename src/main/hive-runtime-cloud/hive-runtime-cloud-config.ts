import { getHiveAccountConfig } from '../hive-account/hive-account-config'

export type HiveRuntimeCloudWebLaunchConfig = Readonly<{
  publicOrigin: 'https://code.hivekernel.com'
  webClientPath: string
  websocketPath: string
}>

export type HiveRuntimeCloudConfig =
  | { enabled: false }
  | {
      enabled: true
      apiBaseUrl: string
      webLaunch?: HiveRuntimeCloudWebLaunchConfig
    }

function enabled(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function originRelativePath(value: string | undefined): string | null {
  if (!value || value.length > 256 || !value.startsWith('/') || value.includes('\\')) {
    return null
  }
  try {
    const parsed = new URL(value, 'https://code.hivekernel.com')
    return parsed.origin === 'https://code.hivekernel.com' &&
      parsed.pathname === value &&
      !parsed.search &&
      !parsed.hash
      ? value
      : null
  } catch {
    return null
  }
}

function webLaunchConfig(env: NodeJS.ProcessEnv): HiveRuntimeCloudWebLaunchConfig | undefined {
  if (!enabled(env.HIVE_RUNTIME_CLOUD_WEB_LAUNCH_ENABLED)) {
    return undefined
  }
  const origin = env.HIVE_RUNTIME_CLOUD_WEB_HTTPS_ORIGIN
  const webClientPath = originRelativePath(env.HIVE_RUNTIME_CLOUD_WEB_CLIENT_PATH)
  const websocketPath = originRelativePath(env.HIVE_RUNTIME_CLOUD_WEBSOCKET_PATH)
  return origin === 'https://code.hivekernel.com' && webClientPath && websocketPath
    ? { publicOrigin: origin, webClientPath, websocketPath }
    : undefined
}

export function getHiveRuntimeCloudConfig(
  env: NodeJS.ProcessEnv = process.env
): HiveRuntimeCloudConfig {
  if (!enabled(env.HIVE_RUNTIME_CLOUD_PRESENCE_ENABLED)) {
    return { enabled: false }
  }
  const account = getHiveAccountConfig(env)
  if (!account.configured) {
    return { enabled: false }
  }
  const webLaunch = webLaunchConfig(env)
  return {
    enabled: true,
    apiBaseUrl: account.config.apiBaseUrl,
    ...(webLaunch ? { webLaunch } : {})
  }
}
