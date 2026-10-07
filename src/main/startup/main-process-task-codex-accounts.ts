import { app } from 'electron'
import { join } from 'node:path'
import type { Store } from '../persistence'
import type { TaskCodexRuntimeAccountPorts } from '../tasks/task-codex-runtime-account-ports'
import {
  resolveSelectedTaskCodexAccountScope,
  resolveTaskCodexAccountScope,
  type TaskCodexAccountScopeDependencies
} from '../tasks/task-codex-account-scope'
import { getSystemCodexHomePath } from '../codex/codex-home-paths'
import { mainProcessState as state } from './main-process-state'

function assertRuntimeHomeAvailable(): void {
  if (!state.codexRuntimeHome) {
    throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
  }
}

export function createMainProcessTaskCodexAccountPorts(
  store: Pick<Store, 'getSettings' | 'onSettingsChanged'>
): TaskCodexRuntimeAccountPorts {
  assertRuntimeHomeAvailable()
  const dependencies: TaskCodexAccountScopeDependencies = {
    getSettings: () => {
      assertRuntimeHomeAvailable()
      return store.getSettings()
    },
    getManagedAccountsRoot: () => {
      assertRuntimeHomeAvailable()
      return join(app.getPath('userData'), 'codex-accounts')
    },
    getSystemCodexHomePath: () => {
      assertRuntimeHomeAvailable()
      return getSystemCodexHomePath()
    }
  }
  return Object.freeze({
    resolveSelected: () => resolveSelectedTaskCodexAccountScope(dependencies),
    resolvePinned: (home: string) => resolveTaskCodexAccountScope(dependencies, home),
    subscribe: (listener: () => void) => {
      assertRuntimeHomeAvailable()
      return store.onSettingsChanged((updates) => {
        if (
          Object.hasOwn(updates, 'codexManagedAccounts') ||
          Object.hasOwn(updates, 'activeCodexManagedAccountId') ||
          Object.hasOwn(updates, 'activeCodexManagedAccountIdsByRuntime')
        ) {
          listener()
        }
      })
    }
  })
}
