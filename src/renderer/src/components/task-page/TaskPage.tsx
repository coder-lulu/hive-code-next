import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, ListTodo, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { isExternalTaskPageRequest } from '@/lib/task-page-request'
import { HiveTeamWorkbench } from './hive/HiveTeamWorkbench'
import { ExternalTaskPage } from './ExternalTaskPage'
import { useTaskPageDismissal } from '../use-task-page-dismissal'

export default function TaskPage(): React.JSX.Element {
  const { t } = useTranslation()
  const pageData = useAppStore((state) => state.taskPageData)
  const closeTaskPage = useAppStore((state) => state.closeTaskPage)
  const activeModal = useAppStore((state) => state.activeModal)
  const [selection, setSelection] = useState(() => ({
    request: pageData,
    native: !isExternalTaskPageRequest(pageData)
  }))
  const native =
    selection.request === pageData ? selection.native : !isExternalTaskPageRequest(pageData)
  useTaskPageDismissal(closeTaskPage, native && activeModal === 'none')
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      <nav
        aria-label={t('hiveWorkbench.navigation')}
        className="flex flex-wrap items-center gap-2 px-5 py-3 md:px-8"
      >
        <Button
          type="button"
          size="sm"
          variant={native ? 'secondary' : 'ghost'}
          aria-pressed={native}
          onClick={() => setSelection({ request: pageData, native: true })}
        >
          <Users />
          {t('hiveWorkbench.open')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={native ? 'ghost' : 'secondary'}
          aria-pressed={!native}
          onClick={() => setSelection({ request: pageData, native: false })}
        >
          <ListTodo />
          {t('hiveWorkbench.externalSources')}
        </Button>
        {native && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={closeTaskPage}
          >
            <X />
            {t('hiveWorkbench.close')}
          </Button>
        )}
      </nav>
      {native ? <HiveTeamWorkbench /> : <ExternalTaskPage />}
    </div>
  )
}
