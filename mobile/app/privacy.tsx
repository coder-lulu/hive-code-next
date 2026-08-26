import { productNameText } from '@/product-brand'
import { useState } from 'react'
import { Linking } from 'react-native'
import {
  FutureFeatureAction,
  FutureFeatureNotice,
  FutureFeatureRow,
  FutureFeatureScreen,
  FutureFeatureSection
} from '../src/capabilities/FutureFeatureUI'
import {
  openConfiguredFutureFeatureUrl,
  resolveFutureFeatureActionState
} from '../src/capabilities/future-feature-state'

const privacyAction = resolveFutureFeatureActionState('privacy', true)

export default function PrivacyScreen() {
  const policyUrl = privacyAction.capability.configurationValue
  const [opening, setOpening] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)

  const openPolicy = async () => {
    setOpenFailed(false)
    setOpening(true)
    const opened = await openConfiguredFutureFeatureUrl(policyUrl, Linking)
    setOpening(false)
    setOpenFailed(!opened)
  }

  return (
    <FutureFeatureScreen
      capabilityId="privacy"
      title="隐私中心"
      description="集中查看隐私文档、权限与数据处理入口。"
    >
      {policyUrl ? (
        <FutureFeatureAction
          disabled={privacyAction.disabled}
          label="查看正式隐私政策"
          loading={opening}
          reason={privacyAction.reason}
          onPress={openPolicy}
        />
      ) : (
        <FutureFeatureNotice title="隐私政策尚未配置">
          当前没有权威隐私政策来源，因此不会在应用内生成或展示推测性条款。
        </FutureFeatureNotice>
      )}

      {openFailed ? (
        <FutureFeatureNotice danger title="未能打开隐私政策">
          {productNameText(
            '系统未能验证或打开已配置的正式链接。为确保来源可信，Orca 未跳转到其他地址。'
          )}
        </FutureFeatureNotice>
      ) : null}

      <FutureFeatureSection title="隐私控制">
        <FutureFeatureRow label="个人信息收集清单" value="后续支持" />
        <FutureFeatureRow label="第三方信息共享清单" value="后续支持" />
        <FutureFeatureRow label="系统权限管理" value="后续支持" />
      </FutureFeatureSection>

      <FutureFeatureNotice title="本地与电脑数据">
        当前页面不会读取、上传或修改已配对电脑的工作区、终端和源码数据。
      </FutureFeatureNotice>
    </FutureFeatureScreen>
  )
}
