import { useTranslation } from 'react-i18next'
import { Loader2, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDelayedStatus } from '@/hooks/use-delayed-status'
import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import { useHiveWorkflows } from './use-hive-workflows'
import { HiveWorkbenchPicker } from './HiveWorkbenchPicker'
import { HiveWorkflowDraftForm } from './HiveWorkflowDraftForm'
import { HiveWorkflowVersionPicker } from './HiveWorkflowVersionPicker'
import { HiveWorkflowConflictReview } from './HiveWorkflowConflictReview'
import { HiveWorkflowCasesSection } from './HiveWorkflowCasesSection'

const validationKeys: Record<string, string> = {
  workflow_definition_invalid: 'invalidDefinition',
  workflow_definition_too_large: 'definitionTooLarge',
  workflow_duplicate_stage: 'duplicateStage',
  workflow_roles_incomplete: 'missingRoles',
  workflow_duplicate_dependency: 'duplicateDependency',
  workflow_unknown_dependency: 'unknownDependency',
  workflow_dependency_cycle: 'dependencyCycle',
  workflow_output_mismatch: 'outputMismatch',
  workflow_test_dependency_required: 'missingHandoff',
  workflow_return_stage_invalid: 'invalidReturn'
}
function errorKey(error: string) {
  if (validationKeys[error]) {
    return `hiveWorkflow.errors.${validationKeys[error]}`
  }
  const key = error.includes('CONFLICT')
    ? 'conflict'
    : error.includes('FORBIDDEN')
      ? 'signIn'
      : error.includes('CAPABILITY_UNAVAILABLE')
        ? 'clientUnavailable'
        : error.includes('INVALID_RESPONSE')
          ? 'invalidResponse'
          : error.includes('INVALID_REQUEST')
            ? 'invalidDefinition'
            : 'unavailable'
  return `hiveWorkflow.errors.${key}`
}

export function HiveWorkflowSection({ team }: { team: HiveWorkbenchTeam }) {
  const { t } = useTranslation()
  const model = useHiveWorkflows(team)
  const pending = useDelayedStatus(`${team.company.id}:${team.project.id}`, model.pending, 200)
  const error = model.error ?? model.refusal
  return (
    <section
      className="space-y-3 border-t border-border pt-5"
      aria-labelledby="hive-workflow-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="hive-workflow-heading" className="text-sm font-medium">
            {t('hiveWorkflow.title')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('hiveWorkflow.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={model.busy}
            onClick={() => {
              void model.refresh()
            }}
          >
            <RefreshCw />
            {t('hiveWorkflow.refresh')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={model.busy || model.dirty}
            onClick={() => model.create((workflowCopyKey) => t(workflowCopyKey))}
          >
            <Plus />
            {t('hiveWorkflow.newWorkflow')}
          </Button>
        </div>
      </div>
      <div
        className="flex h-6 items-center gap-2 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {pending && (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>{t(`hiveWorkflow.pending.${pending}`)}</span>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {t(errorKey(error))}
        </p>
      )}
      {model.items.length > 0 && (
        <div className="space-y-2">
          <WorkflowPicker model={model} />
          {model.dirty && (
            <p className="text-xs text-muted-foreground">{t('hiveWorkflow.draftHelp')}</p>
          )}
        </div>
      )}
      {!model.items.length && !model.busy && !model.error && !model.draft && (
        <p className="text-sm text-muted-foreground">{t('hiveWorkflow.empty')}</p>
      )}
      {model.baseline && (
        <HiveWorkflowCasesSection
          key={`cases:${model.baseline.workflowId}`}
          team={team}
          workflow={model.baseline}
          submissionBlocked={model.busy || model.dirty || model.historical}
        />
      )}
      {model.baseline && (
        <HiveWorkflowVersionPicker
          key={`${model.baseline.workflowId}:${model.baseline.definition.workflowRevision}`}
          snapshot={model.baseline}
          model={model}
        />
      )}
      {model.dirty && model.baseline && !model.incoming && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={model.busy}
          onClick={() => {
            void model.reviewLatest()
          }}
        >
          {t('hiveWorkflow.reviewLatest')}
        </Button>
      )}
      {model.incoming && <HiveWorkflowConflictReview snapshot={model.incoming} model={model} />}
      {model.draft && (
        <HiveWorkflowDraftForm key={model.draft.localRef} draft={model.draft} model={model} />
      )}
    </section>
  )
}
function WorkflowPicker({ model }: { model: ReturnType<typeof useHiveWorkflows> }) {
  const { t } = useTranslation()
  return (
    <HiveWorkbenchPicker
      id="hive-workflow-picker"
      label={t('hiveWorkflow.chooseWorkflow')}
      placeholder={t('hiveWorkflow.chooseWorkflow')}
      items={model.items.map((item) => ({
        id: item.workflowId,
        name: t('hiveWorkflow.listLabel', {
          name: item.name,
          revision: item.definition.workflowRevision
        })
      }))}
      value={model.baseline?.workflowId ?? null}
      disabled={model.busy || model.dirty}
      hasMore={Boolean(model.nextCursor)}
      onLoadMore={() => {
        void model.loadMore()
      }}
      onValueChange={(id) => {
        void model.select(id)
      }}
    />
  )
}
