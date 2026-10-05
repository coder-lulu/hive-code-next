import { describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../../../../shared/update-status-types'
import { buildUpdateCardErrorModel } from './update-card-error-model'
import { APP_DISPLAY_NAME } from '@/product-brand'

function build(
  status: UpdateStatus,
  isLocalBuild = false,
  cachedVersion: string | null = '1.4.200'
) {
  return buildUpdateCardErrorModel({
    status,
    isLocalBuild,
    cachedVersion,
    installError: null,
    compatibilityRelaunching: false,
    compatibilitySetupError: null,
    onChooseLocalBuild: vi.fn(),
    onEnableHttp1Compatibility: vi.fn(),
    onRetryDownload: vi.fn(),
    onRecheck: vi.fn(),
    onInstallRetry: vi.fn()
  })
}

describe('update card error model precedence', () => {
  it('retains install retry when no release version is available', () => {
    const model = build(
      { state: 'error', message: 'Install failed', retryAction: 'install' },
      false,
      null
    )
    expect(model?.summary).toBe('Install failed')
    expect(model?.releaseUrl).toBeUndefined()
    expect(model?.primaryAction?.label).toBe('Try Again')
  })
  it('keeps a local build failure out of platform download recovery', () => {
    const model = build(
      {
        state: 'error',
        source: 'local',
        message: 'New version is not signed by the application owner'
      },
      true
    )
    expect(model?.title).toBe('Local Build Error')
    expect(model?.primaryAction?.label).toBe('Choose Another Build')
    expect(model?.releaseUrl).toBeUndefined()
  })

  it('routes publisher mismatch ahead of the generic retry model', () => {
    const model = build({
      state: 'error',
      message: 'New version 1.4.200 is not signed by the application owner: publisherNames: Orca'
    })
    expect(model?.variant).toBe('security')
    expect(model?.summary).toContain(APP_DISPLAY_NAME)
    expect(model?.summary).not.toContain('Orca')
    expect(model?.detail).toBe(
      'New version 1.4.200 is not signed by the application owner: publisherNames: Orca'
    )
    expect(model?.primaryAction).toBeUndefined()
    expect(model?.manualLabel).toBe('Check official releases')
  })

  it('preserves external diagnostic paths verbatim', () => {
    const message = 'Could not inspect C:\\customer Orca workspace; https://orca.dev'
    expect(build({ state: 'error', message })?.detail).toBe(message)
  })

  it('preserves the pending HTTP/1 compatibility recovery action', () => {
    const onEnableHttp1Compatibility = vi.fn()
    const model = buildUpdateCardErrorModel({
      status: { state: 'error', message: 'net::ERR_HTTP2_PROTOCOL_ERROR' },
      isLocalBuild: false,
      cachedVersion: '1.4.200',
      installError: null,
      compatibilityRelaunching: true,
      compatibilitySetupError: null,
      onChooseLocalBuild: vi.fn(),
      onEnableHttp1Compatibility,
      onRetryDownload: vi.fn(),
      onRecheck: vi.fn(),
      onInstallRetry: vi.fn()
    })
    expect(model?.variant).toBe('http1Compatibility')
    expect(model?.summary).toContain(APP_DISPLAY_NAME)
    expect(model?.summary).not.toContain('Orca')
    expect(model?.primaryAction).toMatchObject({
      label: 'Enable & Restart',
      pendingLabel: 'Restarting...',
      isPending: true,
      onClick: onEnableHttp1Compatibility
    })
  })
})
