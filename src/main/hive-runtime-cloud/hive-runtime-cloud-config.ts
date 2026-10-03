import { getHiveAccountConfig } from '../hive-account/hive-account-config'

export type HiveRuntimeCloudWebLaunchConfig = Readonly<{
  publicOrigin: string
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

function originRelativePath(value: string | undefined, origin: string): string | null {
  if (!value || value.length > 256 || !value.startsWith('/') || value.includes('\\')) {
    return null
  }
  try {
    const parsed = new URL(value, origin)
    return parsed.origin === origin && parsed.pathname === value && !parsed.search && !parsed.hash
      ? value
      : null
  } catch {
    return null
  }
}

function webLaunchConfig(env: NodeJS.ProcessEnv): HiveRuntimeCloudWebLaunchConfig | undefined {
  const origin = env.HIVE_RUNTIME_CLOUD_WEB_HTTPS_ORIGIN
  if (!origin) {
    return undefined
  }
  try {
    const url = new URL(origin)
    if (
      url.protocol !== 'https:' ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.port
    ) {
      return undefined
    }
  } catch {
    return undefined
  }
  const webClientPath = originRelativePath(env.HIVE_RUNTIME_CLOUD_WEB_CLIENT_PATH, origin)
  const websocketPath = originRelativePath(env.HIVE_RUNTIME_CLOUD_WEBSOCKET_PATH, origin)
  return webClientPath && websocketPath
    ? { publicOrigin: origin, webClientPath, websocketPath }
    : undefined
}

export function getHiveRuntimeCloudConfig(
  env: NodeJS.ProcessEnv = process.env
): HiveRuntimeCloudConfig {
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
