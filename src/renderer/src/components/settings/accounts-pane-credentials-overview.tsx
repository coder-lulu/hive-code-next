import { ChevronRight, Info } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { GeminiIcon, MiniMaxIcon, OpenCodeGoIcon } from '../status-bar/icons'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet'
import type { AccountsPaneSectionModel } from './accounts-pane-types'
import { GrokAccountsSection } from './GrokAccountsSection'
import { CursorAccountsSection } from './CursorAccountsSection'
import { renderMiniMaxAccountsSection } from './accounts-pane-minimax-section'
import { renderOpenCodeAccountsSection } from './accounts-pane-provider-setting-sections'

export type CredentialSheetKind = 'opencode' | 'minimax'

function ProviderRow({
  id,
  icon,
  name,
  detail,
  status,
  action
}: {
  id: string
  icon: React.ReactNode
  name: React.ReactNode
  detail: string
  status: string
  action: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      id={id}
      className="accounts-provider-row grid min-h-14 scroll-mt-6 items-center gap-4 px-5 py-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0 truncate text-sm font-semibold">{name}</div>
      </div>
      <div className="accounts-provider-detail truncate text-xs text-muted-foreground">
        {detail}
      </div>
      <div className="accounts-provider-status truncate text-xs text-muted-foreground">
        {status}
      </div>
      <div className="flex items-center justify-end gap-2">{action}</div>
    </div>
  )
}

function CredentialSettingsSheet({
  kind,
  model,
  open,
  onOpenChange
}: {
  kind: CredentialSheetKind
  model: AccountsPaneSectionModel
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const miniMax = kind === 'minimax'
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[560px]">
        <SheetHeader className="border-b border-border/60 px-8 py-7 pr-14">
          <SheetTitle className="flex items-center gap-3 text-xl">
            {miniMax ? <MiniMaxIcon size={28} /> : <OpenCodeGoIcon size={28} />}
            {miniMax ? 'MiniMax' : 'OpenCode Go'}
          </SheetTitle>
          <SheetDescription>
            {miniMax
              ? translate(
                  'auto.components.settings.AccountsPane.miniMaxSheetDescription',
                  'Configure the endpoint and local API key or session cookie used for usage checks.'
                )
              : translate(
                  'auto.components.settings.AccountsPane.openCodeSheetDescription',
                  'Configure the session cookie and optional workspace used for usage checks.'
                )}
          </SheetDescription>
        </SheetHeader>
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {miniMax ? renderMiniMaxAccountsSection(model) : renderOpenCodeAccountsSection(model)}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function AccountsCredentialsOverview({
  model,
  sheet,
  onSheetChange
}: {
  model: AccountsPaneSectionModel
  sheet: CredentialSheetKind | null
  onSheetChange: (sheet: CredentialSheetKind | null) => void
}): React.JSX.Element {
  const miniMaxConfigured = model.miniMaxConfigured || model.miniMaxApiKeyConfigured
  const miniMaxStatus =
    model.miniMaxCredentialLoadState === 'loading'
      ? translate('auto.components.settings.AccountsPane.loading', 'Loading…')
      : model.miniMaxCredentialLoadState === 'error'
        ? translate('auto.components.settings.AccountsPane.readFailed', 'Read failed')
        : miniMaxConfigured
          ? translate('auto.components.settings.AccountsPane.configured', 'Configured')
          : translate('auto.components.settings.AccountsPane.notConfigured', 'Not configured')
  return (
    <TooltipProvider>
      <section aria-labelledby="accounts-credentials-title" className="space-y-3">
        <div>
          <h3 id="accounts-credentials-title" className="text-lg font-semibold">
            {translate(
              'auto.components.settings.AccountsPane.credentialsAndUsage',
              'Credentials & usage'
            )}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.AccountsPane.credentialsDescription',
              'Manage sign-in credentials and usage checks by provider.'
            )}
          </p>
        </div>
        <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
          <ProviderRow
            id="accounts-gemini"
            icon={<GeminiIcon size={22} />}
            name={
              <span className="flex items-center gap-2">
                Gemini{' '}
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                  {translate('auto.components.settings.AccountsPane.experimental', 'Experimental')}
                </span>
              </span>
            }
            detail={translate(
              'auto.components.settings.AccountsPane.geminiScope',
              'Local {{value0}} · CLI OAuth',
              { value0: model.localAccountRuntime.label }
            )}
            status={
              model.settings.geminiCliOAuthEnabled
                ? translate('auto.components.settings.AccountsPane.enabled', 'Enabled')
                : translate('auto.components.settings.AccountsPane.disabled', 'Disabled')
            }
            action={
              <>
                <Switch
                  aria-label={translate(
                    'auto.components.settings.AccountsPane.96f3649526',
                    'Use Gemini CLI credentials (experimental)'
                  )}
                  checked={model.settings.geminiCliOAuthEnabled}
                  onCheckedChange={(checked) => {
                    model.recordFeatureInteraction('usage-tracking')
                    model.updateSettings({ geminiCliOAuthEnabled: checked })
                  }}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={translate(
                        'auto.components.settings.AccountsPane.geminiCredentialHelp',
                        'About Gemini CLI credentials'
                      )}
                    >
                      <Info className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72">
                    {translate(
                      'auto.components.settings.AccountsPane.d676c41fc6',
                      'Extracts OAuth credentials from your local Gemini CLI installation to authenticate with Google. This may stop working if Google changes the CLI.'
                    )}
                  </TooltipContent>
                </Tooltip>
              </>
            }
          />
          <ProviderRow
            id="accounts-opencode-go"
            icon={<OpenCodeGoIcon size={22} />}
            name="OpenCode Go"
            detail={translate(
              'auto.components.settings.AccountsPane.openCodeScope',
              'Shared locally · Cookie and workspace'
            )}
            status={
              model.settings.opencodeSessionCookie
                ? translate('auto.components.settings.AccountsPane.configured', 'Configured')
                : translate('auto.components.settings.AccountsPane.notConfigured', 'Not configured')
            }
            action={
              <Button variant="outline" size="sm" onClick={() => onSheetChange('opencode')}>
                {translate('auto.components.settings.AccountsPane.configure', 'Configure')}
                <ChevronRight className="size-4" />
              </Button>
            }
          />
          <ProviderRow
            id="accounts-minimax"
            icon={<MiniMaxIcon size={22} />}
            name="MiniMax"
            detail={translate(
              'auto.components.settings.AccountsPane.miniMaxScope',
              'Local · {{value0}} · API key / Cookie',
              {
                value0:
                  model.settings.minimaxEndpoint === 'cn'
                    ? translate('auto.components.settings.AccountsPane.endpointChinaShort', 'China')
                    : translate(
                        'auto.components.settings.AccountsPane.endpointOverseasShort',
                        'Overseas'
                      )
              }
            )}
            status={miniMaxStatus}
            action={
              model.miniMaxCredentialLoadState === 'error' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void model.refreshMiniMaxCredentialStatus()}
                >
                  {translate('auto.components.settings.AccountsPane.retry', 'Retry')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => onSheetChange('minimax')}>
                  {translate('auto.components.settings.AccountsPane.configure', 'Configure')}
                  <ChevronRight className="size-4" />
                </Button>
              )
            }
          />
          <GrokAccountsSection />
          <CursorAccountsSection />
        </div>
        <CredentialSettingsSheet
          kind="opencode"
          model={model}
          open={sheet === 'opencode'}
          onOpenChange={(open) => onSheetChange(open ? 'opencode' : null)}
        />
        <CredentialSettingsSheet
          kind="minimax"
          model={model}
          open={sheet === 'minimax'}
          onOpenChange={(open) => onSheetChange(open ? 'minimax' : null)}
        />
      </section>
    </TooltipProvider>
  )
}
