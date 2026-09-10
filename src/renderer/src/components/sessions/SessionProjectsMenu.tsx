import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, FolderKanban } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { selectSessionCatalog } from './session-catalog'

export default function SessionProjectsMenu(): React.JSX.Element {
  useTranslation()
  const [open, setOpen] = useState(false)
  const { projects } = useAppStore(selectSessionCatalog)
  const openSessionsPage = useAppStore((state) => state.openSessionsPage)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 px-2 text-[13px] text-worktree-sidebar-foreground/60"
          aria-label={translate('components.sessions.projects', 'Project sessions')}
        >
          <FolderKanban className="size-4 shrink-0" aria-hidden />
          {translate('components.sessions.projects', 'Project sessions')}
          <ChevronDown className="ml-auto size-3 shrink-0" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 p-0">
        <Command>
          <CommandInput
            placeholder={translate('components.sessions.searchProjects', 'Search projects…')}
          />
          <CommandList>
            <CommandEmpty>
              {translate('components.sessions.noProjects', 'No matching projects')}
            </CommandEmpty>
            {projects.map((project) => (
              <CommandItem
                key={project.key}
                value={project.key}
                keywords={[project.label, project.hostLabel]}
                onSelect={() => {
                  openSessionsPage({ kind: 'project', projectKey: project.key })
                  setOpen(false)
                }}
              >
                <FolderKanban className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{project.label}</span>
                <span className="max-w-24 truncate text-xs text-muted-foreground">
                  {project.hostLabel}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
