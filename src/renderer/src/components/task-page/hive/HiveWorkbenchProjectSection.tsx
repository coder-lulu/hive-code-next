import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store'
import type { HiveWorkbenchModel } from './use-hive-workbench'
import { useHiveWorkspaces } from './use-hive-workspaces'
import { HiveWorkbenchPicker } from './HiveWorkbenchPicker'

export function HiveWorkbenchProjectSection({ model }: { model: HiveWorkbenchModel }) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const choices = useHiveWorkspaces()
  const openProjects = useAppStore((state) => state.openSpacePage)
  const showForm = creating || (!model.projects.items.length && !model.busy && !model.error)
  const currentWorkspace = choices.find(
    (choice) => choice.id === model.selectedProject?.workspaceSelector
  )
  return (
    <section
      className="space-y-3 border-b border-border pb-5"
      aria-labelledby="hive-project-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hive-project-heading" className="text-sm font-medium">
          {t('hiveWorkbench.project')}
        </h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={model.busy}
          onClick={() => setCreating(true)}
        >
          <Plus />
          {t('hiveWorkbench.newProject')}
        </Button>
      </div>
      {model.projects.items.length > 0 && (
        <>
          <HiveWorkbenchPicker
            id="hive-project"
            label={t('hiveWorkbench.project')}
            placeholder={t('hiveWorkbench.chooseProject')}
            items={model.projects.items}
            value={model.projectId}
            disabled={model.busy}
            hasMore={Boolean(model.projects.nextCursor)}
            onLoadMore={() => {
              void model.loadMoreProjects()
            }}
            onValueChange={model.selectProject}
          />
          {model.selectedProject && (
            <p className="break-words text-xs text-muted-foreground">
              {t('hiveWorkbench.linkedWorkspace', {
                name: currentWorkspace?.name ?? t('hiveWorkbench.workspaceUnavailable')
              })}
            </p>
          )}
        </>
      )}
      {showForm && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!model.companyId || !choices.some((choice) => choice.id === workspace)) {
              return
            }
            void model
              .createProject({ companyId: model.companyId, name, workspaceSelector: workspace })
              .then((success) => {
                if (success) {
                  setName('')
                  setCreating(false)
                }
              })
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="hive-project-name">{t('hiveWorkbench.projectName')}</Label>
            <Input
              id="hive-project-name"
              value={name}
              required
              maxLength={160}
              disabled={model.busy}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hive-project-workspace">{t('hiveWorkbench.workspace')}</Label>
            <p className="text-xs text-muted-foreground">{t('hiveWorkbench.workspaceHelp')}</p>
            <HiveWorkbenchPicker
              id="hive-project-workspace"
              label={t('hiveWorkbench.workspace')}
              placeholder={t('hiveTasks.chooseWorkspace')}
              items={choices}
              value={workspace || null}
              disabled={model.busy || !choices.length}
              onValueChange={setWorkspace}
            />
            {!choices.length && (
              <p className="text-xs text-muted-foreground">
                {t('hiveWorkbench.noWorkspaces')}{' '}
                <Button type="button" variant="link" size="xs" onClick={openProjects}>
                  {t('hiveWorkbench.openProjects')}
                </Button>
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {model.projects.items.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                disabled={model.busy}
                onClick={() => setCreating(false)}
              >
                {t('hiveWorkbench.dismiss')}
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                model.busy || !name.trim() || !choices.some((choice) => choice.id === workspace)
              }
            >
              {t('hiveWorkbench.createProject')}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
