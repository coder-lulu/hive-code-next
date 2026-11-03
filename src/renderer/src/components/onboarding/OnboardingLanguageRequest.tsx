import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'

type Props = {
  draft: string
  busy: boolean
  requestState: 'idle' | 'pending' | 'error' | 'success'
  onSubmit: () => void
  onBack: () => void
  onDraftChange: (value: string) => void
}

export function OnboardingLanguageRequest({
  draft,
  busy,
  requestState,
  onSubmit,
  onBack,
  onDraftChange
}: Props): React.JSX.Element {
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <Button variant="ghost" size="sm" type="button" onClick={onBack}>
        <ArrowLeft />
        {translate('onboarding.language.back', 'Languages')}
      </Button>
      <Label htmlFor="onboarding-language-request">
        {translate(
          'onboarding.language.requestPrompt',
          'Which language would you like HiveCode to support?'
        )}
      </Label>
      <Input
        id="onboarding-language-request"
        autoFocus
        maxLength={80}
        value={draft}
        disabled={busy || requestState === 'pending'}
        onChange={(event) => {
          onDraftChange(event.target.value)
        }}
      />
      {requestState === 'success' ? (
        <p role="status" className="text-xs text-muted-foreground">
          {translate(
            'onboarding.language.requestSuccess',
            'Language request recorded. You can continue onboarding.'
          )}
        </p>
      ) : (
        <>
          {requestState === 'error' && (
            <p role="alert" className="text-xs text-destructive">
              {translate(
                'onboarding.language.requestError',
                'Could not record your request. Try again.'
              )}
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={!draft.trim() || draft.trim().length > 80 || requestState === 'pending'}
          >
            {requestState === 'error'
              ? translate('onboarding.language.retry', 'Retry')
              : translate('onboarding.language.requestAction', 'Request language')}
          </Button>
        </>
      )}
    </form>
  )
}
