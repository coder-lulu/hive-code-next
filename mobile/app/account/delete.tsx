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
  const [confirmation, setConfirmation] = useState('')

  return (
    <FutureFeatureScreen
      capabilityId="account"
      title="注销账号"
      description="正式身份服务接入后，此页面将用于完成身份验证和注销确认。"
    >
      <FutureFeatureNotice danger title="当前不会删除任何数据">
        注销能力尚未接入。此页面不会删除本地配对、电脑工作区、终端记录或任何远端数据。
      </FutureFeatureNotice>

      <FutureFeatureSection title="注销影响">
        <FutureFeatureRow label={productNameText('Orca 用户资料')} value="未来删除" />
        <FutureFeatureRow label="云端工作记录" value="未来删除" />
        <FutureFeatureRow label="已连接电脑" value="当前不受影响" />
      </FutureFeatureSection>

      <FutureFeatureInput
        label="输入“注销账号”以确认"
        placeholder="注销账号"
        value={confirmation}
        onChangeText={setConfirmation}
      />
      <FutureFeatureAction destructive disabled label="注销账号" reason={deleteAction.reason} />
    </FutureFeatureScreen>
  )
}
