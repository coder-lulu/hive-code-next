import { resolveQuickCreateLinkedWorkItemPrompt } from '@/lib/linked-work-item-context'

type LinkedWorkItem = Parameters<typeof resolveQuickCreateLinkedWorkItemPrompt>[0]

export function resolveQuickCreationLaunchPrompt(args: {
  linkedWorkItem: LinkedWorkItem
  agentPrompt: string
  note: string
}): { prompt: string; draftPrompt: string | null } {
  const authoredPrompt = args.agentPrompt.trim()
  if (!args.linkedWorkItem && authoredPrompt) {
    return { prompt: authoredPrompt, draftPrompt: null }
  }
  return resolveQuickCreateLinkedWorkItemPrompt(
    args.linkedWorkItem,
    authoredPrompt || args.note.trim()
  )
}
