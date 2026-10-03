import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import type * as WslPaths from '../../shared/wsl-paths'
import type * as WslSessionBridge from '../codex/wsl-codex-session-bridge'
import { testState } from './runtime-home-service-test-harness'

/** Unit fixtures use local temp directories as stand-ins for guest-owned homes. */
export function isolateRuntimeHomeWslCollaborators(): void {
  vi.doMock('./legacy-wsl-runtime-auth-drain', () => ({
    startLegacyWslRuntimeAuthDrain: vi.fn(async () => undefined)
  }))
  vi.doMock('../codex/wsl-codex-session-bridge', async (importOriginal) => ({
    ...(await importOriginal<typeof WslSessionBridge>()),
    startWslCodexSessionBridgeInBackground: vi.fn(async () => undefined),
    syncWslCodexSessionsIntoManagedHome: vi.fn(async () => undefined)
  }))
  vi.doMock('../../shared/wsl-paths', async (importOriginal) => {
    const actual = await importOriginal<typeof WslPaths>()
    return {
      ...actual,
      toWindowsWslUncPath: (linuxPath: string, distro: string): string => {
        const tempRoot = actual.toLinuxPath(testState.userDataDir)
        if (linuxPath.startsWith(`${tempRoot}/`)) {
          return join(testState.userDataDir, ...linuxPath.slice(tempRoot.length + 1).split('/'))
        }
        const accountId = linuxPath.match(
          /^\/home\/alice\/\.local\/share\/orca\/codex-accounts\/([^/]+)\/home$/
        )?.[1]
        if (accountId) {
          const home = join(testState.userDataDir, 'codex-accounts', accountId, 'home')
          if (existsSync(home)) {
            return home
          }
        }
        // Deliberate mounted-drive cases still exercise the real UNC conversion.
        return actual.toWindowsWslUncPath(linuxPath, distro)
      }
    }
  })
}
