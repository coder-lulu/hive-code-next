import { isCustomAgentId } from './commit-message-agent-spec'
import {
  DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES,
  AI_ACTION_IDS,
  SOURCE_CONTROL_TEXT_ACTION_IDS,
  normalizeSourceControlAiActionDefaults,
  readSourceControlActionDefault
} from './source-control-ai-actions'
import { commandTemplateFromOperationInstruction } from './source-control-ai-command-template'
import type {
  SourceControlAiPrCreationDefaults,
  SourceControlAiSettings
} from './source-control-ai-types'

export const DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS: Required<SourceControlAiPrCreationDefaults> =
  {
    draft: false,
    useTemplate: false,
    generateDetailsOnOpen: false,
    openAfterCreate: false
  }

function copyRecord<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value)
}

export function getDefaultSourceControlAiSettings(): SourceControlAiSettings {
  const actions: NonNullable<SourceControlAiSettings['actions']> = {}
  for (const actionId of AI_ACTION_IDS) {
    actions[actionId] = {
      commandInputTemplate: DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES[actionId]
    }
  }
  return {
    enabled: true,
    actions,
    agentId: null,
    selectedModelByAgent: {},
    selectedModelByAgentByHost: {},
    discoveredModelsByAgent: {},
    discoveredModelsByAgentByHost: {},
    selectedThinkingByModel: {},
    customAgentCommand: '',
    instructionsByOperation: { commitMessage: '', pullRequest: '', branchName: '' },
    prCreationDefaults: { ...DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS }
  }
}

export function normalizeSourceControlAiSettings(
  value: SourceControlAiSettings | null | undefined
): SourceControlAiSettings {
  const base = value ?? getDefaultSourceControlAiSettings()
  const defaults = getDefaultSourceControlAiSettings()
  const normalizedActions = normalizeSourceControlAiActionDefaults(base.actions) ?? {}
  const textActions = Object.fromEntries(
    SOURCE_CONTROL_TEXT_ACTION_IDS.map((actionId) => {
      const existing = readSourceControlActionDefault(normalizedActions, actionId)
      const instruction = base.instructionsByOperation?.[actionId]
      const instructionTemplate = instruction
        ? commandTemplateFromOperationInstruction(actionId, instruction)
        : undefined
      const shouldApplyInstructionTemplate =
        instructionTemplate !== undefined &&
        (existing.commandInputTemplate === undefined ||
          existing.commandInputTemplate ===
            DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES[actionId])
      return [
        actionId,
        {
          ...defaults.actions?.[actionId],
          ...(base.agentId && !isCustomAgentId(base.agentId) ? { agentId: base.agentId } : {}),
          ...existing,
          ...(shouldApplyInstructionTemplate ? { commandInputTemplate: instructionTemplate } : {})
        }
      ]
    })
  ) as SourceControlAiSettings['actions']
  return {
    ...defaults,
    enabled: typeof base.enabled === 'boolean' ? base.enabled : defaults.enabled,
    agentId: base.agentId ?? defaults.agentId,
    customAgentCommand:
      typeof base.customAgentCommand === 'string'
        ? base.customAgentCommand
        : defaults.customAgentCommand,
    selectedModelByAgent: { ...defaults.selectedModelByAgent, ...base.selectedModelByAgent },
    selectedModelByAgentByHost:
      copyRecord(base.selectedModelByAgentByHost) ?? defaults.selectedModelByAgentByHost,
    discoveredModelsByAgent:
      copyRecord(base.discoveredModelsByAgent) ?? defaults.discoveredModelsByAgent,
    discoveredModelsByAgentByHost:
      copyRecord(base.discoveredModelsByAgentByHost) ?? defaults.discoveredModelsByAgentByHost,
    selectedThinkingByModel: {
      ...defaults.selectedThinkingByModel,
      ...base.selectedThinkingByModel
    },
    instructionsByOperation: {
      ...defaults.instructionsByOperation,
      ...base.instructionsByOperation
    },
    modelOverridesByOperation: copyRecord(base.modelOverridesByOperation),
    prCreationDefaults: { ...defaults.prCreationDefaults, ...base.prCreationDefaults },
    actions: { ...defaults.actions, ...normalizedActions, ...textActions }
  }
}
