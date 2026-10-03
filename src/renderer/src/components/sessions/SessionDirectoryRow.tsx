import { Archive, ChevronRight, Folder } from 'lucide-react'
import { translate } from '@/i18n/i18n'

export default function SessionDirectoryRow({
  kind,
  count,
  expanded,
  onToggle,
  rowRef,
  index,
  start
}: {
  kind: 'archive' | 'offline'
  count: number
  expanded: boolean
  onToggle: () => void
  rowRef: (element: HTMLButtonElement | null) => void
  index: number
  start: number
}): React.JSX.Element {
  const Icon = kind === 'offline' ? Folder : Archive
  return (
    <button
      type="button"
      className="session-archive-group"
      ref={rowRef}
      data-index={index}
      style={{ transform: `translateY(${start}px)` }}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <Icon className="size-4" aria-hidden />
      <span>
        {kind === 'offline'
          ? translate('components.sessions.offline', 'Offline')
          : translate('components.sessions.archived', 'Archived')}
      </span>
      <span className="session-count">{count}</span>
      <ChevronRight className="size-4" aria-hidden />
    </button>
  )
}
