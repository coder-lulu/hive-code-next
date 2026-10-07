import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { HiveWorkflowCaseDraft } from './hive-workflow-case-draft'
import type { HiveWorkflowCasesModel } from './use-hive-workflow-cases'

export function HiveWorkflowCaseCreateForm({
  draft,
  model
}: {
  draft: HiveWorkflowCaseDraft
  model: HiveWorkflowCasesModel
}) {
  const { t } = useTranslation()
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        void model.create().then((success) => {
          if (success) {
            toast.success(t('hiveWorkflowCases.submitted'))
          }
        })
      }}
    >
      <fieldset className="space-y-3" disabled={model.busy || !model.canCreate}>
        <div className="space-y-2">
          <Label htmlFor="hive-workflow-case-title">
            {t('hiveWorkflowCases.requirementTitle')}
          </Label>
          <Input
            id="hive-workflow-case-title"
            value={draft.title}
            required
            maxLength={240}
            aria-invalid={Boolean(draft.title) && !draft.title.trim()}
            onChange={(event) => model.edit({ title: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="hive-workflow-case-requirement">
              {t('hiveWorkflowCases.requirementBody')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('hiveWorkflowCases.requirementHelp')}
            </p>
          </div>
          <Textarea
            id="hive-workflow-case-requirement"
            value={draft.requirement}
            required
            maxLength={48_000}
            rows={6}
            placeholder={t('hiveWorkflowCases.requirementPlaceholder')}
            aria-invalid={
              Boolean(draft.requirement) &&
              (!draft.requirement.trim() || model.refusal === 'REQUEST_TOO_LARGE')
            }
            onChange={(event) => model.edit({ requirement: event.target.value })}
          />
        </div>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={model.busy} onClick={model.discard}>
          {t('hiveWorkflowCases.discard')}
        </Button>
        <Button type="submit" disabled={model.busy || !model.canCreate || Boolean(model.refusal)}>
          {t('hiveWorkflowCases.submit')}
        </Button>
      </div>
    </form>
  )
}
