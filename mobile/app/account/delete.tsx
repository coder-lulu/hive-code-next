import { useMobileTranslation } from '../../src/i18n/use-mobile-translation'
import { productNameText } from '@/product-brand'
import { useState } from 'react'
import {
  FutureFeatureAction,
  FutureFeatureInput,
  FutureFeatureNotice,
  FutureFeatureRow,
  FutureFeatureScreen,
  FutureFeatureSection
} from '../../src/capabilities/FutureFeatureUI'
import { resolveFutureFeatureActionState } from '../../src/capabilities/future-feature-state'

const deleteAction = resolveFutureFeatureActionState('account', false)

export default function AccountDeleteScreen() {
  const t = useMobileTranslation()

  const [confirmation, setConfirmation] = useState('')

  return (
    <FutureFeatureScreen
      capabilityId="account"
      title={t('auto.mobile.app.account.delete.83aebf3fd5', 'Delete account')}
      description={t(
        'auto.mobile.app.account.delete.d85e672cbd',
        'Once the identity service is connected, use this page to verify your identity and confirm account deletion.'
      )}
    >
      <FutureFeatureNotice
        danger
        title={t('auto.mobile.app.account.delete.41029ea356', 'No data will be deleted now')}
      >
        {t(
          'auto.mobile.app.account.delete.e4019f2efb',
          'Account deletion is not available yet. This page will not delete local pairings, computer workspaces, terminal history, or remote data.'
        )}
      </FutureFeatureNotice>

      <FutureFeatureSection
        title={t('auto.mobile.app.account.delete.0754b85dde', 'What account deletion affects')}
      >
        <FutureFeatureRow label={productNameText('Orca 用户资料')} value="未来删除" />
        <FutureFeatureRow
          label={t('auto.mobile.app.account.delete.779bfe5c56', 'Cloud work records')}
          value="未来删除"
        />
        <FutureFeatureRow
          label={t('auto.mobile.app.account.delete.7950275d85', 'Connected computers')}
          value="当前不受影响"
        />
      </FutureFeatureSection>

      <FutureFeatureInput
        label={t('auto.mobile.app.account.delete.54747237f2', 'Enter “注销账号” to confirm')}
        placeholder={t('auto.mobile.app.account.delete.83aebf3fd5', 'Delete account')}
        value={confirmation}
        onChangeText={setConfirmation}
      />
      <FutureFeatureAction
        destructive
        disabled
        label={t('auto.mobile.app.account.delete.83aebf3fd5', 'Delete account')}
        reason={deleteAction.reason}
      />
    </FutureFeatureScreen>
  )
}
