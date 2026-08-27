import type { App } from 'electron'
import { hivecodeProductConfig } from '../../shared/generated/product-config'

const PRIMARY_SCHEME = hivecodeProductConfig.schemes.primary
const ALL_SCHEMES: readonly string[] = [PRIMARY_SCHEME, ...hivecodeProductConfig.schemes.aliases]

export type ProtocolUrlConsumer = (url: string) => void

export type ProtocolHandlerOptions = {
  app: Pick<App, 'on' | 'setAsDefaultProtocolClient' | 'isDefaultProtocolClient'>
  /** Called when a deep-link URL is received (from open-url or second-instance argv). */
  onUrl: ProtocolUrlConsumer
  /** Platform override for tests. */
  platform?: NodeJS.Platform
}

/**
 * Registers HiveCode as the default protocol handler for the primary and
 * compatibility schemes. On macOS this also wires `app.on('open-url')` so
 * cold-launch deep links are captured.
 *
 * Call this ONCE early in the main-process startup, before `app.whenReady()`.
 * Electron derives protocol registration from `app.name`, so it must be called
 * AFTER `app.setName()` but BEFORE any deep link can arrive.
 */
export function registerProtocolHandlers(opts: ProtocolHandlerOptions): void {
  const platform = opts.platform ?? process.platform

  // Register each scheme as the default protocol client.
  for (const scheme of ALL_SCHEMES) {
    if (opts.app.setAsDefaultProtocolClient(scheme)) {
      // Best-effort: on some Linux DEs this may fail if the .desktop file
      // hasn't been installed yet. The app can still receive URLs via argv.
    }
  }

  // macOS delivers cold-launch URLs via the 'open-url' event.
  if (platform === 'darwin') {
    opts.app.on('open-url', (_event, url) => {
      opts.onUrl(url)
    })
  }
}

/**
 * Extract the first deep-link URL from second-instance argv.
 *
 * When a user clicks a `hivecode://` or `orca://` link and the app is already
 * running, Electron delivers the URL as the last argv element to the primary
 * instance via the `second-instance` event. The OS may also prepend its own
 * flags (e.g. `--` on macOS), so we scan for the first element that looks
 * like one of our supported schemes.
 */
export function extractProtocolUrlFromArgv(
  argv: readonly string[],
  schemes: readonly string[] = ALL_SCHEMES
): string | null {
  for (const arg of argv) {
    for (const scheme of schemes) {
      if (arg.startsWith(`${scheme}://`)) {
        return arg
      }
    }
  }
  return null
}

export { ALL_SCHEMES, PRIMARY_SCHEME }
