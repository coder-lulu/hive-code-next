import { useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle
} from '@/components/ui/sheet'
import { translate } from '@/i18n/i18n'
import type { IntegrationCardStatusTone } from './integration-card-shell'

export function integrationText(key: string, fallback: string): string {
  return translate(`components.integrationSettings.${key}`, fallback)
}

export function IntegrationSettingsRow(props: {
  icon: React.ReactNode
  name: string
  description: React.ReactNode
  rowDescription?: React.ReactNode
  statusLabel: string
  statusTone: IntegrationCardStatusTone
  checking?: boolean
  settingsSectionId?: string
  actions?: React.ReactNode
  children?: React.ReactNode
  rowActionLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const guide = props.name === 'Azure DevOps' || props.name === 'Gitea'
  const label =
    props.rowActionLabel ??
    (guide
      ? integrationText('guide', 'Configuration guide')
      : props.statusTone === 'connected'
        ? integrationText('manage', 'Manage')
        : integrationText('connect', 'Connect'))
  const status = (
    <span className="integration-row-status" data-tone={props.statusTone} role="status">
      {props.checking ? (
        <LoaderCircle className="size-4 motion-safe:animate-spin" />
      ) : (
        <span className="integration-status-dot" aria-hidden />
      )}
      {props.checking ? integrationText('checking', 'Checking…') : props.statusLabel}
    </span>
  )
  return (
    <div className="integration-settings-row" data-settings-section={props.settingsSectionId}>
      <span className="integration-brand-icon">{props.icon}</span>
      <div className="integration-row-copy">
        <p>{props.name}</p>
        <div>{props.rowDescription ?? props.description}</div>
      </div>
      {status}
      <Button
        ref={trigger}
        variant="outline"
        data-integration-row-action
        className="h-auto min-h-9 min-w-0 whitespace-normal [@media(pointer:coarse)]:min-h-11"
        onClick={() => setOpen(true)}
        aria-label={`${label} ${props.name}`}
      >
        {label}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          data-integration-management
          className="z-[101] w-[var(--desktop-settings-drawer-width)] max-w-full sm:max-w-full"
          overlayClassName="z-[100]"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            trigger.current?.focus()
          }}
        >
          <header className="integration-management-header">
            <div className="flex items-center gap-3">
              <span className="integration-brand-icon">{props.icon}</span>
              <div className="min-w-0 flex-1 break-words">
                <SheetTitle>{props.name}</SheetTitle>
                <SheetDescription>
                  {props.name === 'Linear'
                    ? integrationText('linearSubtitle', 'Manage workspaces and access')
                    : props.description}
                </SheetDescription>
              </div>
            </div>
            <div className="mt-4">{status}</div>
          </header>
          <div className="integration-management-body">
            {props.actions && <div className="mb-4 flex flex-wrap gap-2">{props.actions}</div>}
            {props.children}
          </div>
          <footer className="integration-management-footer">
            <SheetClose asChild>
              <Button>{integrationText('done', 'Done')}</Button>
            </SheetClose>
          </footer>
        </SheetContent>
      </Sheet>
    </div>
  )
}
