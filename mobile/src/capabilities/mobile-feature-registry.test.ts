import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from '../product-brand'
import {
  MOBILE_FEATURE_IDS,
  MOBILE_FEATURE_REGISTRY,
  MOBILE_LIVE_FEATURE_IDS,
  getMobileFeatureUnavailableReason,
  parseMobileFeatureConfiguration,
  parseMobileFeatureHttpUrl,
  parseMobileFeatureStatus,
  resolveMobileFeatureCapability
} from './mobile-feature-registry'

describe('mobile feature registry', () => {
  it('registers every feature exactly once', () => {
    expect(new Set(MOBILE_FEATURE_IDS).size).toBe(MOBILE_FEATURE_IDS.length)
    expect(Object.keys(MOBILE_FEATURE_REGISTRY)).toHaveLength(MOBILE_FEATURE_IDS.length)
  })

  it('marks the established application surfaces as live', () => {
    expect(MOBILE_LIVE_FEATURE_IDS).not.toHaveLength(0)
    for (const id of MOBILE_LIVE_FEATURE_IDS) {
      expect(MOBILE_FEATURE_REGISTRY[id].status).toBe('live')
      expect(resolveMobileFeatureCapability(id).isAvailable).toBe(true)
    }
  })

  it('keeps planned UI visible without treating it as operational', () => {
    for (const id of ['cloudWork', 'login', 'storage'] as const) {
      expect(resolveMobileFeatureCapability(id)).toMatchObject({
        status: 'ui-preview',
        isAvailable: false,
        unavailableReason: '此功能当前仅提供界面预览，服务能力正在建设。'
      })
    }
  })

  it('assigns the agreed lifecycle state to every future feature', () => {
    expect(
      Object.fromEntries(
        [
          'cloudWork',
          'login',
          'privacy',
          'legal',
          'feedback',
          'storage',
          'desktopDownload',
          'update',
          'consumerCredits'
        ].map((id) => [
          id,
          MOBILE_FEATURE_REGISTRY[id as keyof typeof MOBILE_FEATURE_REGISTRY].status
        ])
      )
    ).toEqual({
      cloudWork: 'ui-preview',
      login: 'ui-preview',
      privacy: 'configured',
      legal: 'configured',
      feedback: 'configured',
      storage: 'ui-preview',
      desktopDownload: 'configured',
      update: 'configured',
      consumerCredits: 'removed'
    })
  })

  it('never revives removed consumer credits from a status override or configuration', () => {
    expect(
      resolveMobileFeatureCapability('consumerCredits', {
        statusOverride: 'live',
        productConfig: { endpoints: { consumerCredits: 'https://example.com/credits' } }
      })
    ).toEqual({
      id: 'consumerCredits',
      status: 'removed',
      isAvailable: false,
      configurationValue: null,
      unavailableReason: `此功能已从 ${APP_DISPLAY_NAME} 中移除。`
    })
  })
})

describe('mobile feature configuration', () => {
  it('accepts only normalized HTTP(S) links', () => {
    expect(parseMobileFeatureHttpUrl(' https://hivekernel.com/terms ')).toBe(
      'https://hivekernel.com/terms'
    )
    expect(parseMobileFeatureHttpUrl('http://localhost/terms')).toBe('http://localhost/terms')
    expect(parseMobileFeatureHttpUrl('javascript:alert(1)')).toBeNull()
    expect(parseMobileFeatureHttpUrl(null)).toBeNull()
  })

  it('normalizes configured HTTP endpoints and links', () => {
    expect(
      parseMobileFeatureConfiguration({
        publicLinks: {
          privacyPolicy: ' https://hivekernel.com/privacy ',
          termsOfService: 'http://localhost/terms',
          desktopDownload: 'https://hivekernel.com/download'
        },
        endpoints: {
          feedback: 'https://api.hivekernel.com/feedback',
          update: 'https://updates.hivekernel.com/mobile'
        }
      })
    ).toEqual({
      privacyPolicy: 'https://hivekernel.com/privacy',
      termsOfService: 'http://localhost/terms',
      feedbackEndpoint: 'https://api.hivekernel.com/feedback',
      desktopDownload: 'https://hivekernel.com/download',
      updateEndpoint: 'https://updates.hivekernel.com/mobile'
    })
  })

  it('rejects malformed, empty, and unsafe configuration values', () => {
    expect(
      parseMobileFeatureConfiguration({
        publicLinks: {
          privacyPolicy: 'javascript:alert(1)',
          termsOfService: ' ',
          desktopDownload: 42
        },
        endpoints: {
          feedback: 'not a URL',
          update: ['https://updates.hivekernel.com/mobile']
        }
      })
    ).toEqual({
      privacyPolicy: null,
      termsOfService: null,
      feedbackEndpoint: null,
      desktopDownload: null,
      updateEndpoint: null
    })
  })

  it('enables configured capabilities only when their own configuration exists', () => {
    const productConfig = {
      publicLinks: { privacyPolicy: 'https://hivekernel.com/privacy' }
    }
    expect(resolveMobileFeatureCapability('privacy', { productConfig })).toMatchObject({
      status: 'configured',
      isAvailable: true,
      unavailableReason: null
    })
    expect(resolveMobileFeatureCapability('legal', { productConfig })).toMatchObject({
      status: 'configured',
      isAvailable: false,
      unavailableReason: '此功能尚未配置。'
    })
  })
})

describe('mobile feature status parsing', () => {
  it('accepts only known statuses and otherwise uses the caller fallback', () => {
    expect(parseMobileFeatureStatus('configured')).toBe('configured')
    expect(parseMobileFeatureStatus('unknown', 'ui-preview')).toBe('ui-preview')
    expect(parseMobileFeatureStatus(null)).toBe('unsupported')
  })

  it('provides readable fail-closed reasons', () => {
    expect(getMobileFeatureUnavailableReason('unsupported')).toBe('当前运行环境不支持此功能。')
    expect(getMobileFeatureUnavailableReason('configured', false)).toBe('此功能尚未配置。')
    expect(getMobileFeatureUnavailableReason('configured', true)).toBeNull()
    expect(getMobileFeatureUnavailableReason('live')).toBeNull()
  })
})
