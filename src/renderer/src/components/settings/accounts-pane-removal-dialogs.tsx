import { translate } from '@/i18n/i18n'
import {
  removeClaudeProviderAccount,
  removeCodexProviderAccount
} from '@/runtime/runtime-provider-accounts-client'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import type { AccountsPaneSectionModel, RemoveAccountTarget } from './accounts-pane-types'

export function renderAccountsRemovalDialogs(
  model: AccountsPaneSectionModel,
  removeCodexTarget: RemoveAccountTarget | null,
  removeClaudeTarget: RemoveAccountTarget | null
): React.JSX.Element {
  const {
    runClaudeAccountAction,
    runCodexAccountAction,
    setRemoveClaudeTarget,
    setRemoveCodexTarget,
    settings
  } = model
  return (
    <>
      <Dialog
        open={removeCodexTarget !== null && removeCodexTarget.ownerKey === model.accountScopeKey}
        onOpenChange={(open) => !open && setRemoveCodexTarget(null)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.settings.AccountsPane.0d47394635',
                'Remove Codex Account?'
              )}
            </DialogTitle>
            <DialogDescription>
              {removeCodexTarget
                ? translate(
                    'auto.components.settings.AccountsPane.removeCodexDescription',
                    'Remove {{value0}} from {{value1}}? Its managed Codex home, session history, and MCP sign-ins will be permanently deleted.',
                    {
                      value0: removeCodexTarget.label,
                      value1: removeCodexTarget.scopeLabel
                    }
                  )
                : null}
              {removeCodexTarget?.isActive
                ? ` ${translate(
                    'auto.components.settings.AccountsPane.activeRemovalFallback',
                    'HiveCode will switch this environment to the system default account.'
                  )}`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveCodexTarget(null)}>
              {translate('auto.components.settings.AccountsPane.dbb9626ed1', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = removeCodexTarget
                if (!target || target.ownerKey !== model.accountScopeKey) {
                  return
                }
                setRemoveCodexTarget(null)
                void runCodexAccountAction(
                  `remove:${target.id}`,
                  () => removeCodexProviderAccount(settings, target.id),
                  target.runtime
                )
              }}
            >
              {translate('auto.components.settings.AccountsPane.c2d2751587', 'Remove Account')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={removeClaudeTarget !== null && removeClaudeTarget.ownerKey === model.accountScopeKey}
        onOpenChange={(open) => !open && setRemoveClaudeTarget(null)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.settings.AccountsPane.63843e37e2',
                'Remove Claude Account?'
              )}
            </DialogTitle>
            <DialogDescription>
              {removeClaudeTarget
                ? translate(
                    'auto.components.settings.AccountsPane.removeClaudeDescription',
                    'Remove {{value0}} from {{value1}}? HiveCode will permanently delete the managed Claude authentication for this saved account.',
                    {
                      value0: removeClaudeTarget.label,
                      value1: removeClaudeTarget.scopeLabel
                    }
                  )
                : null}
              {removeClaudeTarget?.isActive
                ? ` ${translate(
                    'auto.components.settings.AccountsPane.activeRemovalFallback',
                    'HiveCode will switch this environment to the system default account.'
                  )}`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveClaudeTarget(null)}>
              {translate('auto.components.settings.AccountsPane.dbb9626ed1', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = removeClaudeTarget
                if (!target || target.ownerKey !== model.accountScopeKey) {
                  return
                }
                setRemoveClaudeTarget(null)
                void runClaudeAccountAction(
                  `remove:${target.id}`,
                  () => removeClaudeProviderAccount(settings, target.id),
                  target.runtime
                )
              }}
            >
              {translate('auto.components.settings.AccountsPane.c2d2751587', 'Remove Account')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
