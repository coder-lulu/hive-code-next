import { useId, useRef, useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { parseAgentDefaultEnvDraft, stringifyAgentDefaultEnvDraft } from './agent-default-env-draft'

export function AgentCommandOverrideInput({
  defaultCmd,
  cmdOverride,
  onSaveOverride
}: {
  defaultCmd: string
  cmdOverride: string | undefined
  onSaveOverride: (value: string) => void
}): React.JSX.Element {
  const draftSeed = cmdOverride ?? defaultCmd
  const [cmdDraft, setCmdDraft] = useState(draftSeed)
  const inputId = useId()
  const skipNextBlurCommitRef = useRef(false)
  const commitCmd = (): void => {
    const trimmed = cmdDraft.trim()
    if (!trimmed || trimmed === defaultCmd) {
      onSaveOverride('')
      setCmdDraft(defaultCmd)
    } else {
      onSaveOverride(trimmed)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-[13px] text-muted-foreground">
        {translate('auto.components.settings.AgentsPane.2e45ca29b6', 'Command')}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          value={cmdDraft}
          onChange={(event) => setCmdDraft(event.target.value)}
          onBlur={() => {
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false
              return
            }
            commitCmd()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              skipNextBlurCommitRef.current = true
              commitCmd()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              skipNextBlurCommitRef.current = true
              setCmdDraft(draftSeed)
              event.currentTarget.blur()
            }
          }}
          placeholder={defaultCmd}
          spellCheck={false}
          className="h-9 flex-1 rounded-md font-mono text-[13px] md:text-[13px]"
        />
        {cmdOverride && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              onSaveOverride('')
              setCmdDraft(defaultCmd)
            }}
            className="h-9 shrink-0 rounded-md text-[13px] text-muted-foreground hover:text-foreground"
          >
            {translate('auto.components.settings.AgentsPane.5200dac9da', 'Reset')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function AgentDefaultArgsInput({
  defaultArgs,
  argsOverride,
  onSaveArgs
}: {
  defaultArgs: string
  argsOverride: string
  onSaveArgs: (value: string) => void
}): React.JSX.Element {
  const [argsDraft, setArgsDraft] = useState(argsOverride)
  const inputId = useId()
  const skipNextBlurCommitRef = useRef(false)
  const commitArgs = (): void => onSaveArgs(argsDraft.trim())

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-[13px] text-muted-foreground">
        {translate('auto.components.settings.AgentsPane.cfb3f35775', 'Arguments')}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          value={argsDraft}
          onChange={(event) => setArgsDraft(event.target.value)}
          onBlur={() => {
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false
              return
            }
            commitArgs()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              skipNextBlurCommitRef.current = true
              commitArgs()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              skipNextBlurCommitRef.current = true
              setArgsDraft(argsOverride)
              event.currentTarget.blur()
            }
          }}
          placeholder={
            defaultArgs ||
            translate('auto.components.settings.AgentsPane.6f99bf5dd0', 'No default arguments')
          }
          spellCheck={false}
          className="h-9 flex-1 rounded-md font-mono text-[13px] md:text-[13px]"
        />
        {argsOverride !== defaultArgs && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              onSaveArgs(defaultArgs)
              setArgsDraft(defaultArgs)
            }}
            className="h-9 shrink-0 rounded-md text-[13px] text-muted-foreground hover:text-foreground"
          >
            {translate('auto.components.settings.AgentsPane.5200dac9da', 'Reset')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function AgentDefaultEnvInput({
  defaultEnv,
  envOverride,
  onSaveEnv
}: {
  defaultEnv: Record<string, string>
  envOverride: Record<string, string>
  onSaveEnv: (value: Record<string, string>) => void
}): React.JSX.Element {
  const defaultEnvText = stringifyAgentDefaultEnvDraft(defaultEnv)
  const draftSeed = stringifyAgentDefaultEnvDraft(envOverride)
  const [envDraft, setEnvDraft] = useState(draftSeed)
  const [envDraftTooLarge, setEnvDraftTooLarge] = useState(false)
  const inputId = useId()
  const skipNextBlurCommitRef = useRef(false)
  const envDraftErrorId = useId()
  const commitEnv = (): void => {
    const parsedDraft = parseAgentDefaultEnvDraft(envDraft)
    setEnvDraftTooLarge(parsedDraft.tooLarge)
    if (!parsedDraft.tooLarge) {
      onSaveEnv(parsedDraft.env)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-[13px] text-muted-foreground">
        {translate('auto.components.settings.AgentsPane.8fbe1f37c1', 'Environment')}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          value={envDraft}
          onChange={(event) => {
            setEnvDraft(event.target.value)
            if (envDraftTooLarge) {
              setEnvDraftTooLarge(false)
            }
          }}
          onBlur={() => {
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false
              return
            }
            commitEnv()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              skipNextBlurCommitRef.current = true
              commitEnv()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              skipNextBlurCommitRef.current = true
              setEnvDraft(draftSeed)
              setEnvDraftTooLarge(false)
              event.currentTarget.blur()
            }
          }}
          placeholder={
            defaultEnvText ||
            translate('auto.components.settings.AgentsPane.2d133152fa', 'No default environment')
          }
          spellCheck={false}
          aria-invalid={envDraftTooLarge || undefined}
          aria-describedby={envDraftTooLarge ? envDraftErrorId : undefined}
          className={cn(
            'h-9 flex-1 rounded-md font-mono text-[13px] md:text-[13px]',
            envDraftTooLarge && 'border-destructive/50 bg-destructive/5'
          )}
        />
        {draftSeed !== defaultEnvText && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              onSaveEnv(defaultEnv)
              setEnvDraft(defaultEnvText)
              setEnvDraftTooLarge(false)
            }}
            className="h-9 shrink-0 rounded-md text-[13px] text-muted-foreground hover:text-foreground"
          >
            {translate('auto.components.settings.AgentsPane.5200dac9da', 'Reset')}
          </Button>
        )}
      </div>
      {envDraftTooLarge && (
        <p id={envDraftErrorId} className="mt-1 text-[11px] text-destructive">
          {translate(
            'auto.components.settings.AgentsPane.3f1bdf3cb4',
            'Environment text is too large to parse safely.'
          )}
        </p>
      )}
    </div>
  )
}
