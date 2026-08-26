import { useState } from 'react'
import {
  FutureFeatureAction,
  FutureFeatureInput,
  FutureFeatureRow,
  FutureFeatureScreen,
  FutureFeatureSection
} from '../src/capabilities/FutureFeatureUI'
import { resolveFutureFeatureActionState } from '../src/capabilities/future-feature-state'

const feedbackAction = resolveFutureFeatureActionState('feedback', false)

export default function FeedbackScreen() {
  const [category, setCategory] = useState('功能建议')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')

  return (
    <FutureFeatureScreen
      capabilityId="feedback"
      title="帮助与反馈"
      description="可以整理反馈内容；提交接口接通前，内容只保留在当前页面内。"
    >
      <FutureFeatureSection title="问题类型">
        {['功能建议', '使用问题', '账号问题', '其他问题'].map((item) => (
          <FutureFeatureRow
            key={item}
            label={item}
            selected={category === item}
            value={category === item ? '已选择' : undefined}
            onPress={() => setCategory(item)}
          />
        ))}
      </FutureFeatureSection>

      <FutureFeatureInput
        multiline
        label="反馈内容"
        maxLength={2000}
        placeholder="请描述问题、期望结果和复现步骤"
        value={message}
        onChangeText={setMessage}
      />
      <FutureFeatureInput
        keyboardType="email-address"
        label="联系方式（选填）"
        placeholder="邮箱或其他联系方式"
        value={contact}
        onChangeText={setContact}
      />
      <FutureFeatureSection title="附件">
        <FutureFeatureRow label="截图与诊断文件" value="后续支持" />
      </FutureFeatureSection>

      <FutureFeatureAction disabled label="提交反馈" reason={feedbackAction.reason} />
    </FutureFeatureScreen>
  )
}
