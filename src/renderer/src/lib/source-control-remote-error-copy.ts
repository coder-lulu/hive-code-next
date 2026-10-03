import { translate } from '@/i18n/i18n'

function translateOperationLabel(operation: string): string {
  switch (operation) {
    case 'Publish Branch':
      return translate('components.remoteErrors.publishBranch', 'Publish Branch')
    case 'Sync':
      return translate('components.remoteErrors.sync', 'Sync')
    case 'Force Push':
      return translate('components.remoteErrors.forcePush', 'Force Push')
    case 'Push':
      return translate('components.remoteErrors.push', 'Push')
    case 'Fetch':
      return translate('components.remoteErrors.fetch', 'Fetch')
    case 'Fast-forward':
      return translate('components.remoteErrors.fastForward', 'Fast-forward')
    case 'Rebase':
      return translate('components.remoteErrors.rebase', 'Rebase')
    default:
      return operation
  }
}

export function formatOperationFailure(operation: string, detail: string): string {
  return translate(
    'components.remoteErrors.operationFailedDetail',
    '{{operation}} failed. {{detail}}',
    {
      operation: translateOperationLabel(operation),
      detail
    }
  )
}

export function formatRemoteAccessFailure(operation: string, detail: string): string {
  return translate(
    'components.remoteErrors.remoteAccessFailure',
    '{{operation}} failed. {{detail}}. Check your remote access and try again.',
    {
      operation: translateOperationLabel(operation),
      detail
    }
  )
}

export function formatConnectionFailure(operation: string): string {
  return translate(
    'components.remoteErrors.connectionFailure',
    '{{operation}} failed. Check your connection and try again.',
    { operation: translateOperationLabel(operation) }
  )
}

export function translateSubmoduleFailureDetail(detail: string): string {
  // The shared formatter returns these two application-authored sentences. Only
  // match its complete output; the redacted submodule name remains opaque data.
  const match = detail.match(
    /^(?:Submodule '(.+)'|A submodule) (has remote changes\. Pull inside the submodule, then try again\.|could not be pushed\. Resolve the submodule push error, then try again\.)$/
  )
  if (!match) {
    return detail
  }
  const name = match[1]
  if (match[2].startsWith('has remote changes')) {
    return name
      ? translate(
          'components.remoteErrors.submoduleRemoteChangedNamed',
          "Submodule '{{name}}' has remote changes. Pull inside the submodule, then try again.",
          { name }
        )
      : translate(
          'components.remoteErrors.submoduleRemoteChanged',
          'A submodule has remote changes. Pull inside the submodule, then try again.'
        )
  }
  return name
    ? translate(
        'components.remoteErrors.submodulePushFailedNamed',
        "Submodule '{{name}}' could not be pushed. Resolve the submodule push error, then try again.",
        { name }
      )
    : translate(
        'components.remoteErrors.submodulePushFailed',
        'A submodule could not be pushed. Resolve the submodule push error, then try again.'
      )
}

function translatePushFailureSummary(summary: string): string {
  // Exact generated summaries can be localized; hook/server output retains the
  // existing English formatter's case adjustment without translation.
  switch (summary) {
    case 'Lint failed during push.':
      return translate('components.remoteErrors.lintFailureSummary', 'lint failed during push.')
    case 'Pre-push hook failed.':
      return translate('components.remoteErrors.prePushFailureSummary', 'pre-push hook failed.')
    default:
      return `${summary.charAt(0).toLowerCase()}${summary.slice(1)}`
  }
}

export function formatPushHookFailure(operationLabel: string, summary: string): string {
  return translate(
    'components.remoteErrors.operationBlocked',
    '{{operation}} blocked — {{summary}}',
    {
      operation: translateOperationLabel(operationLabel),
      summary: translatePushFailureSummary(summary)
    }
  )
}

export function operationFailed(): string {
  return translate('components.remoteErrors.operationFailed', 'Remote operation failed')
}

export function rebaseExistingConflicts(): string {
  return translate(
    'components.remoteErrors.rebaseExistingConflicts',
    'Rebase blocked — resolve existing conflicts first.'
  )
}

export function syncExistingConflicts(): string {
  return translate(
    'components.remoteErrors.syncExistingConflicts',
    'Sync blocked — resolve existing merge conflicts first.'
  )
}

export function pullExistingConflicts(): string {
  return translate(
    'components.remoteErrors.pullExistingConflicts',
    'Pull blocked — resolve existing merge conflicts first.'
  )
}

export function rebaseFreshConflicts(): string {
  return translate(
    'components.remoteErrors.rebaseFreshConflicts',
    'Rebase stopped with conflicts. Resolve them in Source Control, then continue the rebase.'
  )
}

export function syncFreshConflicts(): string {
  return translate(
    'components.remoteErrors.syncFreshConflicts',
    'Sync stopped with merge conflicts. Resolve them in Source Control, then commit the merge.'
  )
}

export function pullFreshConflicts(): string {
  return translate(
    'components.remoteErrors.pullFreshConflicts',
    'Pull stopped with merge conflicts. Resolve them in Source Control, then commit the merge.'
  )
}

export function syncRemoteChanged(): string {
  return translate(
    'components.remoteErrors.syncRemoteChanged',
    'Sync failed — remote moved while syncing. Try again.'
  )
}

export function forcePushRemoteChanged(): string {
  return translate(
    'components.remoteErrors.forcePushRemoteChanged',
    'Force push rejected — remote changed since last fetch. Fetch first, then try again.'
  )
}

export function pushRemoteChanged(): string {
  return translate(
    'components.remoteErrors.pushRemoteChanged',
    'Push rejected — remote has changes. Pull first, then try again.'
  )
}

export function rebaseLocalChanges(): string {
  return translate(
    'components.remoteErrors.rebaseLocalChanges',
    'Rebase blocked — commit or stash your local changes first.'
  )
}

export function fastForwardLocalChanges(): string {
  return translate(
    'components.remoteErrors.fastForwardLocalChanges',
    'Fast-forward blocked — commit or stash your local changes first.'
  )
}

export function pullLocalChanges(): string {
  return translate(
    'components.remoteErrors.pullLocalChanges',
    'Pull blocked — commit or stash your local changes first.'
  )
}

export function rebaseUntrackedFiles(): string {
  return translate(
    'components.remoteErrors.rebaseUntrackedFiles',
    'Rebase blocked — move, remove, or add untracked files first.'
  )
}

export function fastForwardUntrackedFiles(): string {
  return translate(
    'components.remoteErrors.fastForwardUntrackedFiles',
    'Fast-forward blocked — move, remove, or add untracked files first.'
  )
}

export function pullUntrackedFiles(): string {
  return translate(
    'components.remoteErrors.pullUntrackedFiles',
    'Pull blocked — move, remove, or add untracked files first.'
  )
}

export function publishFailed(): string {
  return translate(
    'components.remoteErrors.publishFailed',
    'Publish Branch failed. Check your remote access and try again.'
  )
}
