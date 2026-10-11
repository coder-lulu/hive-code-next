import type { NativeTeamTaskToolSession } from '../../shared/hive-team-task-tools'
import type {
  StructuredAgentSessionAcquireInput,
  StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import type {
  CodexAppServerServerRequest,
  CodexAppServerConnection
} from './codex-app-server-connection'
import { openCodexThread } from './codex-structured-thread-open'
import type {
  CodexSession,
  CodexStructuredSessionAdapterDeps,
  CodexStructuredLaunch,
  CodexStructuredSessionEvent
} from './codex-structured-session-state'
import { CodexTeamTaskToolTurns } from './codex-team-task-tool-turns'
import { readCodexTurnId } from './codex-structured-thread-facts'
import { cancelCodexStructuredTurn } from './codex-structured-prompt-ownership'
import { codexStopTarget } from './codex-structured-turn-open-wait'
import { admitCodexTeamToolCall } from './codex-team-task-tool-journal'
import {
  CODEX_TEAM_TASK_TOOL_NAMES,
  parseTeamToolCall,
  teamToolReply,
  TEAM_TOOL_DENIED,
  validTeamToolCatalog
} from './codex-team-task-tool-protocol'

export async function openCodexTeamTaskThread(
  connection: CodexAppServerConnection,
  launch: CodexStructuredLaunch,
  deps: CodexStructuredSessionAdapterDeps,
  input: StructuredAgentSessionAcquireInput,
  assertCurrent: () => void
) {
  const tools = await prepareCodexTeamTaskTools(deps, input)
  assertCurrent()
  const opened = await openCodexThread(
    connection,
    launch,
    deps.requestTimeoutMs,
    tools?.definitions
  )
  assertCurrent()
  const teamTaskTools = await bindCodexTeamTaskTools(
    tools,
    opened.threadId,
    !!launch.resumeThreadId && !opened.supersededThreadId,
    input.events,
    {
      sessionId: input.identity.sessionId,
      logger: deps.logger,
      supersededThreadId: opened.supersededThreadId
    }
  )
  assertCurrent()
  return { opened, teamTaskTools }
}

export async function prepareCodexTeamTaskTools(
  deps: CodexStructuredSessionAdapterDeps,
  input: StructuredAgentSessionAcquireInput
): Promise<NativeTeamTaskToolSession | null> {
  if (input.taskOrigin) {
    return null
  }
  try {
    const tools = await deps.prepareTeamTaskTools?.(input)
    if (tools && !validTeamToolCatalog(tools)) {
      warnTeamToolUnavailable(deps, 'catalog', 'invalid_catalog')
      return null
    }
    return tools ?? null
  } catch {
    warnTeamToolUnavailable(deps, 'prepare', 'prepare_failed')
    return null
  }
}

export async function bindCodexTeamTaskTools(
  tools: NativeTeamTaskToolSession | null,
  threadId: string,
  resumed: boolean,
  sink: StructuredAgentSessionEventSink | undefined,
  context: Pick<CodexStructuredSessionAdapterDeps, 'logger'> & {
    sessionId: string
    supersededThreadId?: string
  }
): Promise<CodexTeamTaskToolHost | null> {
  if (!tools) {
    return null
  }
  try {
    if (!(await tools.bindThread(threadId, resumed, context.supersededThreadId))) {
      warnTeamToolUnavailable(context, 'bind', 'catalog_binding_refused')
      return null
    }
    return new CodexTeamTaskToolHost(tools, threadId, sink, context.sessionId)
  } catch {
    warnTeamToolUnavailable(context, 'bind', 'catalog_binding_failed')
    return null
  }
}

function warnTeamToolUnavailable(
  deps: Pick<CodexStructuredSessionAdapterDeps, 'logger'>,
  phase: 'prepare' | 'catalog' | 'bind',
  code: string
): void {
  try {
    deps.logger?.warn('Team task tools unavailable', {
      scope: 'codex-team-task-tools',
      phase,
      code
    })
  } catch {
    // Diagnostics cannot break ordinary chat acquisition.
  }
}

export class CodexTeamTaskToolHost {
  private readonly turns: CodexTeamTaskToolTurns
  private inFlight = 0
  private unresolvedStop = false

  constructor(
    private readonly tools: NativeTeamTaskToolSession,
    private readonly threadId: string,
    private readonly sink: StructuredAgentSessionEventSink | undefined,
    sessionId: string
  ) {
    this.turns = new CodexTeamTaskToolTurns(sink, sessionId, threadId)
  }

  observe(event: CodexStructuredSessionEvent, admitted: boolean, session: CodexSession): boolean {
    const accepted = this.turns.observe(event, admitted)
    if (!accepted && event.type === 'notification') {
      session.activeTurnIds?.delete(readCodexTurnId(event.params) ?? '')
    }
    return accepted
  }

  revoke(turnId?: string): void {
    this.turns.revoke(turnId)
  }

  revokeUnresolvedStop(): void {
    this.unresolvedStop = true
    this.turns.revoke()
  }

  handle(
    session: CodexSession,
    request: CodexAppServerServerRequest,
    current: () => CodexSession | undefined
  ): boolean {
    if (request.method !== 'item/tool/call') {
      return false
    }
    const raw = request.params
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('tool' in raw) ||
      typeof raw.tool !== 'string' ||
      !CODEX_TEAM_TASK_TOOL_NAMES.has(raw.tool)
    ) {
      return false
    }
    const call = parseTeamToolCall(request.params)
    const connection = session.connection
    const fence = session.fence
    const generation = session.acquisitionGeneration
    const calls = call ? this.turns.calls(call.turnId) : undefined
    let written = false
    const requestIdValid =
      typeof request.id === 'number'
        ? Number.isSafeInteger(request.id)
        : typeof request.id === 'string' && request.id.length > 0 && request.id.length <= 256
    const assertCurrent = (): void => {
      if (
        this.unresolvedStop ||
        !requestIdValid ||
        !call ||
        !calls ||
        current() !== session ||
        session.connection !== connection ||
        session.fence !== fence ||
        session.acquisitionGeneration !== generation ||
        session.ended ||
        session.exitObservedAt !== undefined ||
        session.orcaClose ||
        connection.closed ||
        call.threadId !== this.threadId ||
        session.threadId !== this.threadId ||
        this.turns.calls(call.turnId) !== calls ||
        (written && !this.turns.isDurablyRunning(call.turnId)) ||
        !session.activeTurnIds?.has(call.turnId) ||
        session.abortedTurnIds?.has(call.turnId)
      ) {
        throw new Error('team task caller unavailable')
      }
    }
    try {
      assertCurrent()
      if (!call || !calls || this.inFlight >= 2 || calls.size >= 64 || calls.has(call.callId)) {
        throw new Error('team task call refused')
      }
      calls.add(call.callId)
    } catch {
      connection.respond(request.id, TEAM_TOOL_DENIED)
      return true
    }
    this.inFlight++
    void (async () => {
      try {
        await admitCodexTeamToolCall(this.sink, call, generation, assertCurrent)
        written = true
        assertCurrent()
        const result = await this.tools.call(
          {
            name: call.tool,
            arguments: call.arguments,
            callId: call.callId,
            turnId: call.turnId
          },
          assertCurrent
        )
        assertCurrent()
        connection.respond(request.id, teamToolReply(result.success, result.value))
      } catch {
        // A failed response remains on the originating connection, never its replacement.
        if (!connection.closed) {
          connection.respond(request.id, TEAM_TOOL_DENIED)
        }
      } finally {
        this.inFlight--
      }
    })().catch(() => {})
    return true
  }
}

export function revokeCodexTeamTaskTurn(
  session: CodexSession | undefined,
  request: Parameters<StructuredAgentSessionAdapter['cancelTurn']>[0]
): void {
  if (!session || session.fence !== request.fence) {
    return
  }
  if (request.turnId === undefined && request.prompt) {
    return
  }
  const journalTurnId = request.turnId ?? request.resolveLiveTurnId?.() ?? null
  const target = journalTurnId === null ? codexStopTarget(session) : null
  const turnId =
    journalTurnId !== null
      ? session.translator
        ? session.translator.commandProviderTurnId(journalTurnId)
        : journalTurnId
      : target && ('opening' in target ? target.opening : target.turnId)
  if (turnId) {
    session.teamTaskTools?.revoke(turnId)
  } else if (
    session.dispatchPending ||
    session.dispatchEchoes.size > 0 ||
    (request.dispatchStatus?.state === 'unknown' && !request.dispatchStatus.recovered)
  ) {
    // An unaddressable send may still run; only a fresh acquisition can authorize its tools.
    session.teamTaskTools?.revokeUnresolvedStop()
  } else {
    session.teamTaskTools?.revoke()
  }
}

export function cancelCodexTurnWithTeamToolRevocation(
  input: Parameters<typeof cancelCodexStructuredTurn>[0]
) {
  const liveTurnId =
    input.request.turnId === undefined && !input.request.prompt
      ? (input.request.resolveLiveTurnId?.() ?? null)
      : null
  const request = { ...input.request, resolveLiveTurnId: () => liveTurnId }
  revokeCodexTeamTaskTurn(input.sessions.get(request.sessionId), request)
  return cancelCodexStructuredTurn({ ...input, request })
}
