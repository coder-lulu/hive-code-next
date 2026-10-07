import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDelayedStatus } from '@/hooks/use-delayed-status'
import { useHiveWorkbench, type HiveWorkbenchModel } from './use-hive-workbench'
import { HiveWorkbenchCompanySection } from './HiveWorkbenchCompanySection'
import { HiveWorkbenchProjectSection } from './HiveWorkbenchProjectSection'
import { HiveWorkbenchTeamSection } from './HiveWorkbenchTeamSection'
import { HiveTaskDialog } from './HiveTaskDialog'
import { HiveWorkflowSection } from './HiveWorkflowSection'

function workbenchErrorKey(error: string): string {
  if (error.includes('FORBIDDEN')) {
    return 'hiveWorkbench.signIn'
  }
  if (
    error.includes('WORKSPACE') ||
    error.includes('hive_agent_forbidden') ||
    error.includes('selector_not_found')
  ) {
    return 'hiveWorkbench.invalidWorkspace'
  }
  if (error.includes('CAPABILITY_UNAVAILABLE')) {
    return 'hiveWorkbench.clientUnavailable'
  }
  if (error.includes('CONFLICT')) {
    return 'hiveWorkbench.conflict'
  }
  return 'hiveWorkbench.unavailable'
}
function WorkbenchContent({ model }: { model: HiveWorkbenchModel }) {
  const { t } = useTranslation()
  const pending = useDelayedStatus(String(model.accountRevision), model.pending, 200)
  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-5 pb-5 md:px-8">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold">{t('hiveWorkbench.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('hiveWorkbench.description')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <HiveTaskDialog label={t('hiveWorkbench.personalTasks')} />
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
              {t('hiveWorkbench.refresh')}
            </Button>
          </div>
        </header>
        <div
          className="flex h-6 items-center gap-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {pending && (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>{t(`hiveWorkbench.pending.${pending}`)}</span>
            </>
          )}
        </div>
        {model.error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {t(workbenchErrorKey(model.error))}
          </p>
        )}
        <HiveWorkbenchCompanySection model={model} />
        {model.companyId && <HiveWorkbenchProjectSection key={model.companyId} model={model} />}
        {model.team && (
          <HiveWorkbenchTeamSection
            key={`${model.team.project.id}:${model.team.project.binding.bindingRevision}`}
            model={model}
            team={model.team}
          />
        )}
        {model.team && (
          <HiveWorkflowSection
            key={`${model.accountRevision}:${model.team.company.id}:${model.team.project.id}:${model.team.project.binding.bindingRevision}`}
            team={model.team}
          />
        )}
      </div>
    </div>
  )
}
export function HiveTeamWorkbench() {
  const model = useHiveWorkbench()
  return <WorkbenchContent key={model.accountRevision} model={model} />
}
