import { Laptop, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TabHoverCard } from './TabHoverCard'
import { translate } from '@/i18n/i18n'
import type { ClientHostedBrowserRow } from '../../../../shared/client-hosted-browser-rows'
import { ACTIVE_TAB_INDICATOR_CLASSES, getTabRootStateClasses } from './drop-indicator'
import {
  describeClientHostedBrowserRowHost,
  getClientHostedBrowserRowLabel
} from './client-hosted-browser-row-label'
import { preventMiddleButtonDefault } from './middle-button-default-guard'
import { TAB_LABEL_WIDTH_CLASSES } from './tab-width-rules'
import { useTabStripSlotProps } from './use-tab-strip-slot-props'

/** Paired-client pages have no unified tab: expose presence and close without persisted ordering, pinning or drag actions. */
export default function ClientHostedBrowserTab({
  row,
  isActive,
  onActivate,
  onClose
}: {
  row: ClientHostedBrowserRow
  isActive: boolean
  onActivate: () => void
  onClose: () => void
}): React.JSX.Element {
  const slotProps = useTabStripSlotProps(row.browserPageId, isActive)
  const loading = row.loading && !row.hostAbsent
  const PageIcon = loading ? Loader2 : Laptop
  const label = getClientHostedBrowserRowLabel(row)
  const hostDescription = describeClientHostedBrowserRowHost(row)

  return (
    <div {...slotProps}>
      <TabHoverCard
        title={label}
        programName={translate('tabHoverCard.browser', 'Browser')}
        icon={<Laptop className="size-4" />}
        description={hostDescription}
      >
        <div
          data-client-hosted-browser-row-id={row.browserPageId}
          data-active={isActive ? 'true' : 'false'}
          role="button"
          tabIndex={0}
          aria-pressed={isActive}
          className={`${getTabRootStateClasses(isActive)}`}
          onPointerDown={onActivate}
          onKeyDown={(event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === 'Enter' || event.key === ' ')
            ) {
              event.preventDefault()
              onActivate()
            }
          }}
          onMouseDown={(event) => {
            if (event.button === 1) {
              event.preventDefault()
            }
          }}
          onMouseUp={preventMiddleButtonDefault}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }
          }}
        >
          {isActive && <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden />}
          <PageIcon
            className={`mr-1 size-4 shrink-0 ${loading ? 'motion-safe:animate-spin' : ''} ${row.hostAbsent ? 'text-muted-foreground' : 'text-blue-500'}`}
            aria-hidden
          />
          <span
            className={`${TAB_LABEL_WIDTH_CLASSES} mr-1 ${row.hostAbsent ? 'text-muted-foreground' : ''}`}
          >
            {label}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            data-tab-close-button="true"
            aria-label={translate('browser.clientHosted.hostRowClose', 'Close hosted page')}
            className="tab-close-button motion-reduce:transition-none"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </TabHoverCard>
    </div>
  )
}
