import type { CustomAgentId } from './commit-message-agent-spec'
import type { AiTextOperation } from './source-control-ai-types'
import type { TuiAgent } from './tui-agent'

export function commandTemplateFromInstruction(instruction: string | null | undefined): string {
  const trimmed = instruction?.trim()
  return trimmed ? ['{basePrompt}', '', trimmed].join('\n') : '{basePrompt}'
}

export function commandTemplateFromOperationInstruction(
  operation: AiTextOperation,
  instruction: string | null | undefined
): string {
  const trimmed = instruction?.trim()
  if (!trimmed) {
    return '{basePrompt}'
  }
  return operation === 'branchName'
    ? [trimmed, '', '{basePrompt}'].join('\n')
    : commandTemplateFromInstruction(trimmed)
}

export function hasActionAgentRecipe(recipe: {
  agentId?: TuiAgent | CustomAgentId | null
}): recipe is { agentId: TuiAgent | CustomAgentId | null } {
  return Object.hasOwn(recipe, 'agentId')
}
