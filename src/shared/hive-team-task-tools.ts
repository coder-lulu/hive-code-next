export type NativeTeamTaskToolSession = {
  bindThread(threadId: string, resumed: boolean, supersededThreadId?: string): Promise<boolean>
  definitions: readonly {
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }[]
  call(
    input: { name: string; arguments: unknown; callId: string; turnId: string },
    assertCurrent: () => void
  ): Promise<{ success: boolean; value: Record<string, unknown> }>
}

export type NativeTeamTaskToolFactory = (input: {
  sessionId: string
  workspaceSelector: string
  assertCurrent: () => void
}) => NativeTeamTaskToolSession
