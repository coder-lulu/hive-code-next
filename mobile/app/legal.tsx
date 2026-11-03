import { productNameText } from '@/product-brand'
import { useState } from 'react'
import { Linking } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
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

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default function LegalScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ document?: string | string[] }>()
  const isPrivacy = firstParam(params.document) === 'privacy'
  const capabilityId = isPrivacy ? 'privacy' : 'legal'
  const title = isPrivacy ? '隐私政策' : '服务协议'
  const documentAction = resolveFutureFeatureActionState(capabilityId, true)
  const documentUrl = documentAction.capability.configurationValue
  const [opening, setOpening] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)

  const openDocument = async () => {
    setOpenFailed(false)
    setOpening(true)
    const opened = await openConfiguredFutureFeatureUrl(documentUrl, Linking)
    setOpening(false)
    setOpenFailed(!opened)
  }

  return (
    <FutureFeatureScreen
      capabilityId={capabilityId}
      title={title}
      description="法律文档只展示产品配置中的权威来源，不使用示例文字代替正式条款。"
    >
      <FutureFeatureSection title="文档类型">
        <FutureFeatureRow
          label="服务协议"
          selected={!isPrivacy}
          value={!isPrivacy ? '当前' : undefined}
          onPress={() => router.replace({ pathname: '/legal', params: { document: 'terms' } })}
        />
        <FutureFeatureRow
          label="隐私政策"
          selected={isPrivacy}
          value={isPrivacy ? '当前' : undefined}
          onPress={() => router.replace({ pathname: '/legal', params: { document: 'privacy' } })}
        />
      </FutureFeatureSection>

      {documentUrl ? (
        <FutureFeatureAction
          disabled={documentAction.disabled}
          label={`打开正式${title}`}
          loading={opening}
          reason={documentAction.reason}
          onPress={openDocument}
        />
      ) : (
        <FutureFeatureNotice title={`${title}尚未配置`}>
          当前没有可验证的正式文档地址。为避免错误或误导，此处不生成正文，也不会跳转到其他页面。
        </FutureFeatureNotice>
      )}

      {openFailed ? (
        <FutureFeatureNotice danger title={`未能打开${title}`}>
          {productNameText(
            '系统未能验证或打开已配置的正式链接。为确保来源可信，Orca 未跳转到其他地址。'
          )}
        </FutureFeatureNotice>
      ) : null}
    </FutureFeatureScreen>
  )
}
