import { translate } from '@/i18n/i18n'
export function AgentPreferencesHint({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[13px] leading-[18px] text-muted-foreground">
      <p>
        {translate(
          'agentsSettings.preferencesHint',
          'Status hooks, tab titles, sleep, cache and permissions are in Run preferences.'
        )}
      </p>
      <button
        type="button"
        className="rounded-md px-2 py-1 font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
      >
        {translate('agentsSettings.openPreferences', 'Run preferences →')}
      </button>
    </div>
  )
}
