import { useMobileTranslation } from '../src/i18n/use-mobile-translation'
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
  const t = useMobileTranslation()

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
      title={t('auto.mobile.app.privacy.2ed11021aa', 'Privacy center')}
      description={t(
        'auto.mobile.app.privacy.9d674fc15d',
        'View privacy documents, permissions, and data handling options in one place.'
      )}
    >
      {policyUrl ? (
        <FutureFeatureAction
          disabled={privacyAction.disabled}
          label={t('auto.mobile.app.privacy.8bec93be5f', 'View the official privacy policy')}
          loading={opening}
          reason={privacyAction.reason}
          onPress={openPolicy}
        />
      ) : (
        <FutureFeatureNotice
          title={t('auto.mobile.app.privacy.deeb02fa0d', 'Privacy policy is not configured')}
        >
          {t(
            'auto.mobile.app.privacy.8689823031',
            'No authoritative privacy policy is available, so the app will not generate or display speculative terms.'
          )}
        </FutureFeatureNotice>
      )}

      {openFailed ? (
        <FutureFeatureNotice
          danger
          title={t('auto.mobile.app.privacy.278e436d14', 'Could not open the privacy policy')}
        >
          {productNameText(
            '系统未能验证或打开已配置的正式链接。为确保来源可信，Orca 未跳转到其他地址。'
          )}
        </FutureFeatureNotice>
      ) : null}

      <FutureFeatureSection title={t('auto.mobile.app.privacy.b0e1606f77', 'Privacy controls')}>
        <FutureFeatureRow
          label={t('auto.mobile.app.privacy.6fce0bb813', 'Personal information collection list')}
          value="后续支持"
        />
        <FutureFeatureRow
          label={t('auto.mobile.app.privacy.5c81466d71', 'Third-party information sharing list')}
          value="后续支持"
        />
        <FutureFeatureRow
          label={t('auto.mobile.app.privacy.6f94af9742', 'System permission settings')}
          value="后续支持"
        />
      </FutureFeatureSection>

      <FutureFeatureNotice
        title={t('auto.mobile.app.privacy.28c4de1688', 'Local and computer data')}
      >
        {t(
          'auto.mobile.app.privacy.b0ca358b55',
          'This page will not read, upload, or modify workspace, terminal, or source code data on paired computers.'
        )}
      </FutureFeatureNotice>
    </FutureFeatureScreen>
  )
}
