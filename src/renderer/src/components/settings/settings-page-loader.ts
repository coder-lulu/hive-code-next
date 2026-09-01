import type SettingsPage from './Settings'
import type { HiveAccountSettingsPane } from './HiveAccountSettingsPane'

type SettingsPageModule = { default: typeof SettingsPage }
type HiveAccountPaneModule = {
  default: typeof HiveAccountSettingsPane
}

export function createRetryableModuleLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    if (pending) {
      return pending
    }
    try {
      let guarded: Promise<T>
      guarded = load().catch((error: unknown) => {
        if (pending === guarded) {
          pending = null
        }
        throw error
      })
      pending = guarded
      return guarded
    } catch (error) {
      return Promise.reject(error)
    }
  }
}

const loadSettingsPageModule = createRetryableModuleLoader<SettingsPageModule>(
  () => import('./Settings')
)
const loadHiveAccountPaneModule = createRetryableModuleLoader<HiveAccountPaneModule>(() =>
  import('./HiveAccountSettingsPane').then((module) => ({
    default: module.HiveAccountSettingsPane
  }))
)

export function loadSettingsPage(): Promise<SettingsPageModule> {
  return loadSettingsPageModule()
}

export function loadHiveAccountSettingsPane(): Promise<HiveAccountPaneModule> {
  return loadHiveAccountPaneModule()
}

export function preloadHiveAccountSettings(): void {
  void Promise.all([loadSettingsPage(), loadHiveAccountSettingsPane()]).catch(() => undefined)
}
