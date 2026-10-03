import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useHiveTasks } from './use-hive-tasks'
import { useHiveWorkspaces } from './use-hive-workspaces'
import { createBrowserUuid } from '@/lib/browser-uuid'

export function HiveTaskDialog({ label }: { label?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [input, setInput] = useState('')
  const [workspace, setWorkspace] = useState('')
  const request = useRef({ signature: '', id: '' })
  const choices = useHiveWorkspaces()
  const tasks = useHiveTasks(open)
  const submit = async () => {
    const signature = JSON.stringify([title.trim(), input.trim(), workspace])
    if (request.current.signature !== signature) {
      request.current = { signature, id: createBrowserUuid() }
    }
    if (
      await tasks.create({
        requestId: request.current.id,
        title,
        input,
        workspaceSelector: workspace
      })
    ) {
      setTitle('')
      setInput('')
      request.current = { signature: '', id: '' }
    }
  }
  const errorText = tasks.error?.includes('FORBIDDEN')
    ? t('hiveTasks.signIn')
    : tasks.error?.includes('OUTCOME_UNKNOWN')
      ? t('hiveTasks.unknownHelp')
      : t('hiveTasks.unavailable')
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {label ?? t('hiveTasks.open')}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-full flex-col overflow-hidden sm:max-w-3xl">
        <div className="scrollbar-sleek min-h-0 space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('hiveTasks.open')}</DialogTitle>
            <DialogDescription>{t('hiveTasks.description')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="hive-task-title">{t('hiveTasks.title')}</Label>
              <Input
                id="hive-task-title"
                autoFocus
                value={title}
                maxLength={240}
                disabled={tasks.busy}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hive-task-workspace">{t('hiveTasks.workspace')}</Label>
              <Select value={workspace} onValueChange={setWorkspace} disabled={tasks.busy}>
                <SelectTrigger id="hive-task-workspace">
                  <SelectValue placeholder={t('hiveTasks.chooseWorkspace')} />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((choice) => (
                    <SelectItem key={choice.id} value={choice.id}>
                      {choice.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="hive-task-input">{t('hiveTasks.input')}</Label>
              <Textarea
                id="hive-task-input"
                value={input}
                maxLength={48_000}
                rows={4}
                disabled={tasks.busy}
                required
                onChange={(event) => setInput(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={tasks.busy}
                onClick={() => {
                  void tasks.refresh()
                }}
              >
                {t('hiveTasks.refresh')}
              </Button>
              <Button
                type="submit"
                disabled={
                  tasks.busy ||
                  !title.trim() ||
                  !input.trim() ||
                  !choices.some((choice) => choice.id === workspace)
                }
              >
                {t(tasks.busy ? 'hiveTasks.working' : 'hiveTasks.create')}
              </Button>
            </div>
          </form>
          {tasks.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorText}
            </p>
          )}
          <div className="divide-y divide-border border-t border-border">
            {tasks.tasks.length === 0 && !tasks.error && (
              <p className="py-3 text-sm text-muted-foreground">{t('hiveTasks.empty')}</p>
            )}
            {tasks.tasks.map((task) => (
              <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`hiveTasks.status.${task.status}`)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {task.artifactRefs.map((ref, index) => (
                    <Button
                      key={ref}
                      size="sm"
                      variant="outline"
                      disabled={tasks.busy}
                      onClick={() => {
                        void tasks.readArtifact(task.id, ref)
                      }}
                    >
                      {t('hiveTasks.artifact', { number: index + 1 })}
                    </Button>
                  ))}
                  {['pending', 'running', 'unknown'].includes(task.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={tasks.busy}
                      onClick={() => {
                        void tasks.cancel(task.id)
                      }}
                    >
                      {t('hiveTasks.cancel')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {tasks.artifact && (
            <section className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{tasks.artifact.name}</h3>
                <Button size="sm" variant="ghost" onClick={tasks.clearArtifact}>
                  {t('hiveTasks.closeArtifact')}
                </Button>
              </div>
              <pre className="scrollbar-sleek max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
                {tasks.artifact.text}
              </pre>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
