import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  enabledMobileLoginProviders,
  mobileLoginAttemptAllowed,
  type MobileLoginConfiguration
} from './mobile-login-presentation'

const configuration: MobileLoginConfiguration = {
  registrationEnabled: true,
  providers: [
    { id: 'github', enabled: true, accessibilityLabel: '使用 GitHub 登录' },
    { id: 'wechat', enabled: false, accessibilityLabel: '使用微信登录' },
    { id: 'qq', enabled: true, accessibilityLabel: '使用 QQ 登录' }
  ]
}

describe('mobile login presentation', () => {
  it('renders only enabled providers in the server-supplied order', () => {
    expect(enabledMobileLoginProviders(configuration).map((provider) => provider.id)).toEqual([
      'github',
      'qq'
    ])
    expect(enabledMobileLoginProviders({ ...configuration, providers: [] })).toEqual([])
  })

  it('blocks every authentication entry until the agreement is checked', () => {
    expect(mobileLoginAttemptAllowed(false)).toBe(false)
    expect(mobileLoginAttemptAllowed(true)).toBe(true)
  })

  it('uses a transparent modal route and the exact approved login copy', () => {
    const route = [
      readFileSync(new URL('../../app/login.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('./MobileLoginBottomSheet.tsx', import.meta.url), 'utf8')
    ].join('\n')
    const layout = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8')

    for (const copy of [
      '登录 HiveCode',
      '同步云端任务、工作区与账号偏好',
      '手机号登录',
      '其他方式登录',
      '已阅读并同意',
      '《服务协议》',
      '《隐私政策》'
    ]) {
      expect(route).toContain(copy)
    }
    for (const prohibited of [
      '身份服务尚未接入',
      '当前源码未配置',
      '登录蜂核智能',
      'WorkBuddy',
      'HvieCode'
    ]) {
      expect(route).not.toContain(prohibited)
    }
    expect(layout).toContain("presentation: 'transparentModal'")
  })
})
