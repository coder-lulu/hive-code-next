import { useMobileTranslation } from '../src/i18n/use-mobile-translation'
import { productNameText } from '@/product-brand'
import {
  FutureFeatureAction,
  FutureFeatureNotice,
  FutureFeatureRow,
  FutureFeatureScreen,
  FutureFeatureSection
} from '../src/capabilities/FutureFeatureUI'
import { resolveFutureFeatureActionState } from '../src/capabilities/future-feature-state'

const storageAction = resolveFutureFeatureActionState('storage', false)

export default function StorageScreen() {
  const t = useMobileTranslation()

  return (
    <FutureFeatureScreen
      capabilityId="storage"
      title={t('auto.mobile.app.storage.4f7657eff5', 'Storage')}
      description={productNameText('查看 Orca 在当前设备上的本地数据分类。')}
    >
      <FutureFeatureNotice
        title={t('auto.mobile.app.storage.e74925882e', 'Waiting for native storage statistics')}
      >
        {t(
          'auto.mobile.app.storage.1db06d6d28',
          'Native storage statistics are not connected yet. Sample capacities, estimated usage, and fabricated cleanup results are not shown.'
        )}
      </FutureFeatureNotice>

      <FutureFeatureSection title={t('auto.mobile.app.storage.70e1b6ca13', 'Local data')}>
        <FutureFeatureRow
          label={t('auto.mobile.app.storage.5b94057956', 'App cache')}
          value="等待统计"
        />
        <FutureFeatureRow
          label={t('auto.mobile.app.storage.0a51252da9', 'Logs and diagnostics')}
          value="等待统计"
        />
        <FutureFeatureRow
          label={t('auto.mobile.app.storage.1d8310e8f6', 'Downloads')}
          value="等待统计"
        />
        <FutureFeatureRow
          label={t('auto.mobile.app.storage.e50e6a74d8', 'Local session state')}
          value="等待统计"
        />
      </FutureFeatureSection>

      <FutureFeatureAction
        disabled
        label={t('auto.mobile.app.storage.a04a524ebb', 'Clear removable data')}
        reason={storageAction.reason}
      />
    </FutureFeatureScreen>
  )
}
