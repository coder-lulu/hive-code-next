import { Laptop, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { ClientHostedBrowserRow } from '../../../../shared/client-hosted-browser-rows'
import { ACTIVE_TAB_SHAPE_CLASSES, getTabRootStateClasses } from './drop-indicator'
import {
  describeClientHostedBrowserRowHost,
  getClientHostedBrowserRowLabel
} from './client-hosted-browser-row-label'
import { preventMiddleButtonDefault } from './middle-button-default-guard'
import { TAB_CONTAINER_WIDTH_CLASSES, TAB_LABEL_WIDTH_CLASSES } from './tab-width-rules'

/**
 * A page rendering on a paired client desktop, shown in this host's strip.
 *
 * Intentionally thinner than BrowserTab: no drag, no pin, no reorder, no close-others. Those all
 * act on a unified tab, and this row has none — it is derived from the runtime's page registry and
 * exists only in memory. What it does own is presence and a close.
 */
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
  const loading = row.loading && !row.hostAbsent
  const PageIcon = loading ? Loader2 : Laptop
  const label = getClientHostedBrowserRowLabel(row)
  const hostDescription = describeClientHostedBrowserRowHost(row)

  return (
    <div className={TAB_CONTAINER_WIDTH_CLASSES}>
      <Tooltip>
        <TooltipTrigger asChild>
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
            {isActive && <span className={ACTIVE_TAB_SHAPE_CLASSES} aria-hidden />}
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
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={6}
          className="max-w-80 whitespace-normal break-words text-left"
        >
          <div>{label}</div>
          <div className="text-muted-foreground">{hostDescription}</div>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
