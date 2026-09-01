import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

describe('Settings lazy-loading contract', () => {
  it('renders a visible page fallback while the Settings shell is loading', () => {
    const shellSource = readSource('src/renderer/src/app-shell/AppWorkspaceShell.tsx')

    expect(shellSource).toContain('const Settings = lazy(loadSettingsPage')
    expect(shellSource).toContain('<Suspense fallback={<AppPageLoadingFallback />}>')
    expect(shellSource).not.toContain("lazy(() => import('../components/settings/Settings'))")
  })

  it('keeps pane implementations out of the Settings shell chunk', () => {
    const settingsSource = readSource('src/renderer/src/components/settings/Settings.tsx')
    const paneSource = readSource(
      'src/renderer/src/components/settings/settings-pane-components.ts'
    )
    const loaderSource = readSource('src/renderer/src/components/settings/settings-page-loader.ts')

    expect(settingsSource).not.toContain("from './HiveAccountSettingsPane'")
    expect(settingsSource).not.toContain("from './GeneralPane'")
    expect(loaderSource).toContain("import('./HiveAccountSettingsPane')")
    expect(paneSource).toContain("import('./GeneralPane')")
    expect(paneSource).toContain('{ fallback: createElement(SettingsPaneLoading) }')
    expect(settingsSource).toContain("isSectionMounted('input') ? (")
    expect(paneSource).toContain(
      'return props.mounted ? createElement(LazyPluginsSettingsSection, props) : null'
    )
  })

  it('preloads the Settings shell and account pane from the account trigger', () => {
    const footerSource = readSource('src/renderer/src/components/sidebar/SidebarFooter.tsx')
    const artifactsSource = readSource('src/renderer/src/components/artifacts/ArtifactsPage.tsx')
    const loaderSource = readSource('src/renderer/src/components/settings/settings-page-loader.ts')

    expect(footerSource).toContain('onPointerEnter={preloadHiveAccountSettings}')
    expect(footerSource).toContain('onFocus={preloadHiveAccountSettings}')
    expect(artifactsSource).toContain('preloadHiveAccountSettings()')
    expect(loaderSource).toContain(
      'Promise.all([loadSettingsPage(), loadHiveAccountSettingsPane()])'
    )
  })
})
