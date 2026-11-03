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
  return (
    <FutureFeatureScreen
      capabilityId="storage"
      title="存储空间"
      description={productNameText('查看 Orca 在当前设备上的本地数据分类。')}
    >
      <FutureFeatureNotice title="等待原生统计">
        原生存储统计尚未接入，因此不展示示例容量、估算占用或虚构的清理结果。
      </FutureFeatureNotice>

      <FutureFeatureSection title="本地数据">
        <FutureFeatureRow label="应用缓存" value="等待统计" />
        <FutureFeatureRow label="日志与诊断" value="等待统计" />
        <FutureFeatureRow label="下载内容" value="等待统计" />
        <FutureFeatureRow label="会话本地状态" value="等待统计" />
      </FutureFeatureSection>

      <FutureFeatureAction disabled label="清理可移除数据" reason={storageAction.reason} />
    </FutureFeatureScreen>
  )
}
