import { isAbsolute, join } from 'node:path'

/** Build from an allowlist: empty provider overrides still fall back to process.env. */
export function createManagedPiEnvironment(
  parent: NodeJS.ProcessEnv,
  managedHome: string
): NodeJS.ProcessEnv {
  if (!isAbsolute(managedHome)) {
    throw new Error('Managed Pi home must be absolute')
  }
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['SystemRoot', 'WINDIR', 'SystemDrive']) {
    const actualKey = Object.keys(parent).find((entry) => entry.toLowerCase() === key.toLowerCase())
    if (actualKey && parent[actualKey]) {
      env[key] = parent[actualKey]
    }
  }
  return {
    ...env,
    PATH: join(managedHome, 'bin'),
    HOME: managedHome,
    USERPROFILE: managedHome,
    APPDATA: join(managedHome, 'config'),
    LOCALAPPDATA: join(managedHome, 'data'),
    XDG_CONFIG_HOME: join(managedHome, 'config'),
    XDG_DATA_HOME: join(managedHome, 'data'),
    XDG_CACHE_HOME: join(managedHome, 'cache'),
    TMPDIR: join(managedHome, 'tmp'),
    TEMP: join(managedHome, 'tmp'),
    TMP: join(managedHome, 'tmp'),
    PI_CODING_AGENT_DIR: join(managedHome, 'agent'),
    ORCA_BACKGROUND_LAUNCH: '1'
  }
}
