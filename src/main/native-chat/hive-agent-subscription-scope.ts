import { readHiveAgentJournal } from './hive-agent-journal-reference'
import { randomUUID } from 'node:crypto'
import { hiveAgentMethodSchemas } from '../../shared/hive-agent-session-methods'
import type {
  HiveAgentHostDependencies,
  HiveAgentPrincipalResolver
} from './hive-agent-session-host'
import type {
  AgentSessionSubscriberEmit,
  AgentSessionSubscribers
} from './agent-session-wire/structured-agent-session-subscribers'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'

/** Bounded lifetime handles over the existing subscriber implementation; no event queue. */
export class HiveAgentSubscriptionScope {
  private readonly disposers = new Set<() => void>()
  private closed = false
  constructor(
    private readonly deps: HiveAgentHostDependencies,
    private readonly subscribers: AgentSessionSubscribers,
    private readonly authorize: (
      method: string,
      resolve: HiveAgentPrincipalResolver,
      entry?: HiveAgentSessionEntry | null
    ) => unknown
  ) {}

  async open(
    raw: unknown,
    resolve: HiveAgentPrincipalResolver,
    emit: AgentSessionSubscriberEmit
  ): Promise<() => void> {
    this.authorize('hiveAgent.subscribe', resolve)
    if (this.closed || this.disposers.size >= 32) {
      throw new Error('hive_agent_capability_unavailable')
    }
    const parsed = hiveAgentMethodSchemas['hiveAgent.subscribe'].safeParse(raw)
    if (!parsed.success) {
      throw new Error('hive_agent_invalid_request')
    }
    const params = parsed.data
    const entry = this.deps.store.hive.get(params.sessionId)
    this.authorize('hiveAgent.subscribe', resolve, entry)
    if (!entry) {
      throw new Error('hive_agent_forbidden')
    }
    let release: (() => void) | undefined
    let disposed = false
    const dispose = () => {
      if (!disposed) {
        disposed = true
        this.disposers.delete(dispose)
        release?.()
      }
    }
    this.disposers.add(dispose)
    try {
      const journal = await readHiveAgentJournal(this.deps, entry)
      if (disposed || this.closed) {
        throw new Error('hive_agent_capability_unavailable')
      }
      release = this.subscribers.open({
        id: randomUUID(),
        sessionId: params.sessionId,
        journal,
        cursor: params.cursor,
        fence: this.deps.fenceFor(entry),
        emit: (event) => {
          try {
            const current = this.deps.store.hive.get(params.sessionId)
            if (!current) {
              throw new Error('hive_agent_forbidden')
            }
            this.authorize('hiveAgent.subscribe', resolve, current)
            emit(
              'page' in event
                ? { ...event, page: { ...event.page, sessionId: params.sessionId } }
                : event
            )
          } catch (error) {
            dispose()
            throw error
          }
        }
      })
      if (disposed) {
        release()
      }
      return dispose
    } catch (error) {
      dispose()
      throw error
    }
  }

  close(): void {
    this.closed = true
    for (const dispose of this.disposers) {
      dispose()
    }
  }
}
