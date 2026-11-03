import { useMobileTranslation } from '../src/i18n/use-mobile-translation'
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
  const t = useMobileTranslation()

  const [category, setCategory] = useState('功能建议')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')

  return (
    <FutureFeatureScreen
      capabilityId="feedback"
      title={t('auto.mobile.app.feedback.a387c9bdb6', 'Help and feedback')}
      description={t(
        'auto.mobile.app.feedback.0d77be4306',
        'Draft your feedback here. Until submission is connected, it stays on this page only.'
      )}
    >
      <FutureFeatureSection title={t('auto.mobile.app.feedback.11b8360806', 'Issue type')}>
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
        label={t('auto.mobile.app.feedback.ccc3c394d4', 'Feedback')}
        maxLength={2000}
        placeholder={t(
          'auto.mobile.app.feedback.2bbcd7be90',
          'Describe the issue, expected result, and steps to reproduce it'
        )}
        value={message}
        onChangeText={setMessage}
      />
      <FutureFeatureInput
        keyboardType="email-address"
        label={t('auto.mobile.app.feedback.00614a343b', 'Contact details (optional)')}
        placeholder={t('auto.mobile.app.feedback.be4b12bc8a', 'Email or other contact details')}
        value={contact}
        onChangeText={setContact}
      />
      <FutureFeatureSection title={t('auto.mobile.app.feedback.bd8c5695ea', 'Attachments')}>
        <FutureFeatureRow
          label={t('auto.mobile.app.feedback.36943f1f75', 'Screenshots and diagnostic files')}
          value="后续支持"
        />
      </FutureFeatureSection>

      <FutureFeatureAction
        disabled
        label={t('auto.mobile.app.feedback.5acab6e376', 'Submit feedback')}
        reason={feedbackAction.reason}
      />
    </FutureFeatureScreen>
  )
}
