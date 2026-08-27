import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  openConfiguredFutureFeatureUrl,
  resolveFutureFeatureActionState
} from './future-feature-state'

const routePaths = [
  '../../app/account.tsx',
  '../../app/account/delete.tsx',
  '../../app/privacy.tsx',
  '../../app/legal.tsx',
  '../../app/feedback.tsx',
  '../../app/storage.tsx'
]

describe('future feature action state', () => {
  it('does not enable a planned submit when configuration appears early', () => {
    expect(
      resolveFutureFeatureActionState('feedback', false, {
        endpoints: { feedback: 'https://api.hivekernel.com/feedback' }
      })
    ).toMatchObject({
      disabled: true,
      reason: '此功能的服务能力尚未接入。',
      capability: { status: 'configured', isAvailable: true }
    })
  })

  it('enables an implemented external document action only with a valid URL', () => {
    expect(
      resolveFutureFeatureActionState('privacy', true, {
        publicLinks: { privacyPolicy: 'https://hivekernel.com/privacy' }
      })
    ).toMatchObject({
      disabled: false,
      reason: null,
      capability: { configurationValue: 'https://hivekernel.com/privacy' }
    })
    expect(
      resolveFutureFeatureActionState('privacy', true, {
        publicLinks: { privacyPolicy: 'javascript:alert(1)' }
      })
    ).toMatchObject({
      disabled: true,
      reason: '此功能尚未配置。',
      capability: { configurationValue: null }
    })
  })

  it('keeps preview and removed actions fail-closed', () => {
    expect(resolveFutureFeatureActionState('login', true)).toMatchObject({
      disabled: true,
      capability: { status: 'ui-preview' }
    })
    expect(resolveFutureFeatureActionState('consumerCredits', true)).toMatchObject({
      disabled: true,
      capability: { status: 'removed' }
    })
  })

  it('opens only configured HTTP(S) links that the platform accepts', async () => {
    const opener = {
      canOpenURL: vi.fn().mockResolvedValue(true),
      openURL: vi.fn().mockResolvedValue(undefined)
    }

    await expect(
      openConfiguredFutureFeatureUrl('https://hivekernel.com/privacy', opener)
    ).resolves.toBe(true)
    expect(opener.openURL).toHaveBeenCalledWith('https://hivekernel.com/privacy')

    opener.canOpenURL.mockClear()
    opener.openURL.mockClear()
    await expect(openConfiguredFutureFeatureUrl('javascript:alert(1)', opener)).resolves.toBe(false)
    expect(opener.canOpenURL).not.toHaveBeenCalled()
    expect(opener.openURL).not.toHaveBeenCalled()
  })

  it('fails closed when a configured link is unsupported or cannot be opened', async () => {
    const unsupportedOpener = {
      canOpenURL: vi.fn().mockResolvedValue(false),
      openURL: vi.fn().mockResolvedValue(undefined)
    }
    await expect(
      openConfiguredFutureFeatureUrl('https://hivekernel.com/terms', unsupportedOpener)
    ).resolves.toBe(false)
    expect(unsupportedOpener.openURL).not.toHaveBeenCalled()

    const failingOpener = {
      canOpenURL: vi.fn().mockResolvedValue(true),
      openURL: vi.fn().mockRejectedValue(new Error('platform rejected link'))
    }
    await expect(
      openConfiguredFutureFeatureUrl('https://hivekernel.com/terms', failingOpener)
    ).resolves.toBe(false)
  })
})

describe('future feature route shells', () => {
  it('keeps routes managed by the future-feature capability in the shared shell', () => {
    for (const relativePath of routePaths) {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
      expect(source).toContain('export default function')
      expect(source).toContain('FutureFeatureScreen')
    }
  })

  it('contains no consumer credit UI or identifiers', () => {
    const source = routePaths
      .map((relativePath) =>
        readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
      )
      .join('\n')
    expect(source).not.toMatch(/积分|consumerCredits|consumer credit/i)
  })

  it('keeps unimplemented account, feedback, and storage actions explicit', () => {
    const sourceByRoute = Object.fromEntries(
      routePaths.map((relativePath) => [
        relativePath,
        readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
      ])
    )

    expect(sourceByRoute['../../app/account.tsx']).toContain('当前仅提供账号界面预览')
    expect(sourceByRoute['../../app/account/delete.tsx']).toContain('当前不会删除任何数据')
    expect(sourceByRoute['../../app/feedback.tsx']).toContain('内容只保留在当前页面内')
    expect(sourceByRoute['../../app/storage.tsx']).toContain('不展示示例容量')
  })
})
