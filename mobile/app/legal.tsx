import { useMobileTranslation } from '../src/i18n/use-mobile-translation'
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
  const t = useMobileTranslation()

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
      description={t(
        'auto.mobile.app.legal.eea4cde650',
        'Legal documents use only authoritative sources configured for this product. Sample text does not replace formal terms.'
      )}
    >
      <FutureFeatureSection title={t('auto.mobile.app.legal.10179e7e21', 'Document type')}>
        <FutureFeatureRow
          label={t('auto.mobile.app.legal.8a806d6ade', 'Terms of service')}
          selected={!isPrivacy}
          value={!isPrivacy ? '当前' : undefined}
          onPress={() => router.replace({ pathname: '/legal', params: { document: 'terms' } })}
        />
        <FutureFeatureRow
          label={t('auto.mobile.app.legal.98ca2cece5', 'Privacy policy')}
          selected={isPrivacy}
          value={isPrivacy ? '当前' : undefined}
          onPress={() => router.replace({ pathname: '/legal', params: { document: 'privacy' } })}
        />
      </FutureFeatureSection>

      {documentUrl ? (
        <FutureFeatureAction
          disabled={documentAction.disabled}
          label={t('auto.mobile.app.legal.a0899e6bd5', 'Open official {{value0}}', {
            value0: title
          })}
          loading={opening}
          reason={documentAction.reason}
          onPress={openDocument}
        />
      ) : (
        <FutureFeatureNotice
          title={t('auto.mobile.app.legal.4df65a3cea', '{{value0}} is not configured', {
            value0: title
          })}
        >
          {t(
            'auto.mobile.app.legal.2730ca6999',
            'No official document address can be verified. To avoid misleading information, no document text is generated and no other page is opened.'
          )}
        </FutureFeatureNotice>
      )}

      {openFailed ? (
        <FutureFeatureNotice
          danger
          title={t('auto.mobile.app.legal.6f98f546bd', 'Could not open {{value0}}', {
            value0: title
          })}
        >
          {productNameText(
            '系统未能验证或打开已配置的正式链接。为确保来源可信，Orca 未跳转到其他地址。'
          )}
        </FutureFeatureNotice>
      ) : null}
    </FutureFeatureScreen>
  )
}
