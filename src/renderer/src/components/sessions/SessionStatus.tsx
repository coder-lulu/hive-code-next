import {
  Circle,
  CircleAlert,
  CircleCheck,
  Clock3,
  LoaderCircle,
  ShieldQuestion,
  Unplug
} from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { SessionListStatus } from '../sidebar/session-list-status'

export function sessionActivityLabel(activity: SessionListStatus['activity']): string {
  switch (activity) {
    case 'running':
      return translate('components.sessions.status.running', 'Working')
    case 'waiting':
      return translate('components.sessions.status.waiting', 'Waiting for input')
    case 'permission':
      return translate('components.sessions.status.permission', 'Approval needed')
    case 'completed':
      return translate('components.sessions.status.completed', 'Completed')
    case 'error':
      return translate('components.sessions.status.error', 'Needs attention')
    case 'unknown':
      return translate('components.sessions.status.unknown', 'Status unknown')
  }
}

export function SessionConnection({
  status
}: {
  status: SessionListStatus
}): React.JSX.Element | null {
  if (status.connection === 'connected') {
    return null
  }
  const pending = status.connection === 'connecting' || status.connection === 'reconnecting'
  const label = pending
    ? translate('components.sessions.reconnecting', 'Reconnecting')
    : status.connection === 'unknown'
      ? translate('components.sessions.connectionUnknown', 'Connection unknown')
      : translate('components.sessions.disconnected', 'Host unavailable')
  return (
    <span className="session-connection" title={label} aria-label={label}>
      <Unplug className="size-3 shrink-0" aria-hidden />
      <span>{label}</span>
    </span>
  )
}

export default function SessionStatus({
  status,
  iconOnly = false
}: {
  status: SessionListStatus
  iconOnly?: boolean
}): React.JSX.Element {
  const Icon = {
    running: LoaderCircle,
    waiting: Clock3,
    permission: ShieldQuestion,
    completed: CircleCheck,
    error: CircleAlert,
    unknown: Circle
  }[status.activity]
  return (
    <span
      className="session-activity"
      data-activity={status.activity}
      title={sessionActivityLabel(status.activity)}
      aria-label={iconOnly ? sessionActivityLabel(status.activity) : undefined}
    >
      <Icon
        className={status.activity === 'running' ? 'size-3 motion-safe:animate-spin' : 'size-3'}
        aria-hidden
      />
      {!iconOnly && <span>{sessionActivityLabel(status.activity)}</span>}
    </span>
  )
}
