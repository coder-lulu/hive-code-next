import { useCallback, useEffect, useRef, useState } from 'react'
import type { HiveAiModelSelection, HiveAiProtocol } from '../../../../shared/hive-ai-model-catalog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { useHiveAiRead } from './use-hive-ai-read'

const readModels = () => window.api.hiveAccount.readAiModels()
const copy = (key: string, fallback: string) => translate(`hiveAiModelSelection.${key}`, fallback)
const protocolName = (protocol: HiveAiProtocol) =>
  protocol === 'RESPONSES' ? 'Responses' : 'Chat Completions'

export function HiveAiModelSelectionSection({
  accountId
}: {
  accountId: string
}): React.JSX.Element {
  const command = useRef<HiveAiModelSelection | null>(null)
  const selectModel = useCallback(async () => {
    if (!command.current) {
      throw new Error('hive_ai_invalid_model_selection')
    }
    return window.api.hiveAccount.selectAiModel(command.current)
  }, [])
  const {
    snapshot,
    loading,
    failed,
    refresh,
    activating: choosing,
    activationFailed: selectionFailed,
    activate
  } = useHiveAiRead(accountId, readModels, selectModel)
  const [query, setQuery] = useState('')
  useEffect(() => {
    setQuery('')
  }, [accountId])

  function choose(modelId: string, protocol: HiveAiProtocol) {
    if (!snapshot || loading || choosing || document.visibilityState !== 'visible') {
      return
    }
    command.current = {
      modelId,
      protocol,
      snapshotRevision: snapshot.catalog.snapshotRevision
    }
    void activate()
  }

  const models =
    snapshot?.catalog.models.filter((model) =>
      model.modelId.toLowerCase().includes(query.trim().toLowerCase())
    ) ?? []
  return (
    <section
      aria-label={copy('title', 'Available AI models')}
      aria-busy={loading || choosing}
      className="rounded-xl border border-border/60 bg-card p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{copy('title', 'Available AI models')}</h3>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || choosing}
          onClick={() => void refresh()}
        >
          {copy('refresh', 'Refresh models')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {copy(
          'description',
          'Models available to your AI account. Choose a default model for HiveCode AI tasks during this login.'
        )}
      </p>
      <div aria-live="polite" className="break-words text-xs text-muted-foreground">
        {loading
          ? copy('loading', 'Loading available models…')
          : failed
            ? copy(
                'unavailable',
                'Available models could not be loaded. Check your AI account credentials or refresh.'
              )
            : snapshot?.selection
              ? `${copy('selected', 'Selected')}: ${snapshot.selection.modelId} · ${protocolName(snapshot.selection.protocol)}`
              : copy('noSelection', 'No model selected.')}
        {selectionFailed && (
          <p role="alert">
            {copy(
              'selectionFailed',
              'The selection was not confirmed. Refresh the model list and choose again.'
            )}
          </p>
        )}
      </div>
      {snapshot && !loading && !failed && (
        <>
          <div className="space-y-1">
            <Label htmlFor="hive-ai-model-search" className="text-xs">
              {copy('search', 'Search models')}
            </Label>
            <Input
              id="hive-ai-model-search"
              value={query}
              disabled={choosing}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {models.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {snapshot.catalog.models.length
                ? copy('noMatches', 'No matching models.')
                : copy('empty', 'No text models are available to this account.')}
            </p>
          )}
          <ul className="divide-y divide-border/60">
            {models.map((model) => (
              <li
                key={model.modelId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span className="min-w-0 break-all text-sm font-medium">{model.modelId}</span>
                <div className="flex min-w-0 max-w-full flex-wrap gap-2">
                  {model.protocols.map((protocol) => (
                    <Button
                      key={protocol}
                      variant="outline"
                      size="sm"
                      className="h-auto min-h-8 max-w-full whitespace-normal py-2"
                      aria-label={`${copy('choose', 'Choose')} ${model.modelId} ${protocolName(protocol)}`}
                      aria-pressed={
                        snapshot.selection?.modelId === model.modelId &&
                        snapshot.selection.protocol === protocol
                      }
                      disabled={choosing}
                      onClick={() => void choose(model.modelId, protocol)}
                    >
                      {copy('choose', 'Choose')} {protocolName(protocol)}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
