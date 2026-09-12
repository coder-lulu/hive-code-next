import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const routePaths = [
  '../../app/about.tsx',
  '../../app/browser-settings.tsx',
  '../../app/voice-settings.tsx',
  '../../app/notifications.tsx',
  '../../app/troubleshoot.tsx',
  '../../app/connection-log.tsx'
] as const

function routeSource(relativePath: string): string {
  const extracted: Record<string, string[]> = {
    '../../app/about.tsx': ['./about-screen.tsx'],
    '../../app/browser-settings.tsx': ['./browser-settings-screen.tsx'],
    '../../app/notifications.tsx': [
      './notification-settings-screen.tsx',
      './native-notification-settings-operations.ts'
    ],
    '../../app/voice-settings.tsx': [
      './voice-settings-screen.tsx',
      './native-voice-settings-operations.ts'
    ],
    '../../app/troubleshoot.tsx': [
      '../diagnostics/use-troubleshoot-diagnostics.ts',
      '../diagnostics/troubleshoot-view.tsx',
      '../diagnostics/native-diagnostics-operations.ts'
    ],
    '../../app/connection-log.tsx': [
      '../diagnostics/connection-diagnostics-screen.tsx',
      '../diagnostics/connection-diagnostics-screen-data.ts',
      '../diagnostics/connection-diagnostics-view.tsx',
      '../diagnostics/native-diagnostics-operations.ts'
    ]
  }
  return [relativePath, ...(extracted[relativePath] ?? [])]
    .map((file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'))
    .join('\n')
}

describe('Graphite settings subpages', () => {
  it('uses semantic themes and shared 44dp safe-area headers on every route', () => {
    for (const path of routePaths) {
      const source = routeSource(path)
      expect(source).toContain('useMobileTheme')
      expect(source).toContain('MobileScreenHeader')
      expect(source).toContain('MobileIconButton')
      expect(source).not.toMatch(
        /import\s*\{[^}]*\b(?:colors|spacing|typography|radii)\b[^}]*\}\s*from\s*['"][^'"]*mobile-theme['"]/i
      )
      expect(source).not.toMatch(/\bcolors\.|#[0-9a-f]{3,8}/i)
    }
  })

  it('keeps browser preference persistence and Chinese picker copy', () => {
    const source = routeSource('../../app/browser-settings.tsx')
    expect(source).toContain('loadTerminalLinkOpenMode().then(')
    expect(source).toContain('if (active)')
    expect(source).toContain('setLinkMode(mode)')
    expect(source).toContain('saveTerminalLinkOpenMode(mode)')
    expect(source).toContain("value: 'orca-browser'")
    expect(source).toContain("value: 'phone-browser'")
    expect(source).toContain('打开终端链接')
    expect(source).toContain('手机浏览器')
  })

  it('keeps notification permission denial fail-closed', () => {
    const source = routeSource('../../app/notifications.tsx')
    expect(source).toContain('ensureNotificationPermissions()')
    expect(source).toContain('getNotificationPermissionState()')
    expect(source).toContain('operations.preference(value && permission.granted)')
    expect(source).toContain('savePushNotificationsEnabled(enabled)')
    expect(source).toContain('Linking.openSettings()')
    expect(source).toContain('系统设置中已关闭通知权限')
  })

  it('keeps voice host RPC and model lifecycle behavior', () => {
    const source = routeSource('../../app/voice-settings.tsx')
    for (const behavior of [
      'useFocusedSettingsHostClients',
      'fetchDictationSetup',
      'setDictationConfig',
      'downloadDictationModel',
      'deleteDictationModel',
      'useDictationSetupPoller'
    ]) {
      expect(source).toContain(behavior)
    }
    expect(source).toContain('连接电脑后才能管理语音设置')
    expect(source).toContain('MobileSegmentedControl')

    const modelList = readFileSync(
      fileURLToPath(new URL('../components/VoiceModelList.tsx', import.meta.url)),
      'utf8'
    )
    expect(modelList).toContain('useMobileTheme')
    expect(modelList).toContain('推荐')
    expect(modelList).toContain('使用中')
    expect(modelList).not.toMatch(/\bcolors\./)
  })

  it('keeps diagnostic execution, connection-log navigation, and cancellation', () => {
    const source = routeSource('../../app/troubleshoot.tsx')
    expect(source).toContain('startDiagnosticFetchTimeout(5000)')
    expect(source).toContain('testHostReachability(host.endpoint)')
    expect(source).toContain("fetch('https://dns.google/resolve?name=example.com&type=A'")
    expect(source).toContain("router.push('/connection-log')")
    expect(source).toContain('activeInternetCheckRef.current?.dispose()')
    expect(source).toContain('运行诊断')

    const commonIssues = readFileSync(
      fileURLToPath(new URL('../diagnostics/troubleshoot-common-issues.tsx', import.meta.url)),
      'utf8'
    )
    expect(commonIssues).toContain('设备不在同一网络')
    expect(commonIssues).toContain('防火墙阻止 6768 端口')
  })

  it('keeps live connection acquisition and diagnostics copy behavior', () => {
    const source = routeSource('../../app/connection-log.tsx')
    expect(source).toContain('useHostClient(selected?.id)')
    expect(source).toContain('useSyncExternalStore(subscribe, getSnapshot)')
    expect(source).toContain('buildConnectionDiagnosticsReport')
    expect(source).toContain('Clipboard.setStringAsync(report)')
    expect(source).toContain('复制报告')
  })

  it('keeps configured About links and runtime version metadata', () => {
    const source = routeSource('../../app/about.tsx')
    expect(source).toContain('PRODUCT_PUBLIC_LINKS.website')
    expect(source).toContain('PRODUCT_SOURCE_REPOSITORY_URL')
    expect(source).toContain('PRODUCT_PUBLIC_LINKS.social')
    expect(source).toContain('Constants.expoConfig?.version')
    expect(source).toContain("productNameText('关于 HiveCode')")
  })
})
