import { hivecodeProductConfig } from '../../shared/generated/product-config'

export const DEFAULT_MAC_COMMAND_PATH = `/usr/local/bin/${hivecodeProductConfig.cli.primary}`
export const DEV_COMMAND_NAME = 'orca-dev'
export const LEGACY_LINUX_COMMAND_NAME = 'orca'
export const DEV_LAUNCHER_DIR = ['cli', 'bin'] as const
export const WINDOWS_PATH_WRITE_TIMEOUT_MS = 5_000
