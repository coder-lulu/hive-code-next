import { randomBytes, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import {
  isAgentSessionId,
  type AgentSessionProcessIdentity
} from '../../shared/agent-session-record'
import { hiveAgentSessionIdSchema } from '../../shared/hive-agent-session-schema'
import { managedPiObject } from '../../shared/managed-pi-process-protocol'
import {
  readProcessStartTimeMs,
  probeAgentSessionProcessIdentity,
  PROCESS_START_TIME_TOLERANCE_MS
} from './agent-session-process-identity-probe'
import {
  verifyManagedPiRuntimeIdentity,
  type VerifiedManagedPiPack
} from './managed-pi-runtime-identity'
import { ManagedPiProcessTransport, managedPiDeadline } from './managed-pi-process-transport'

/** The execution host supplies its reservation/guard; this port does not mint a lease. */
export type ManagedPiExecutionOwnership = {
  sessionId: string
  runtimeRecordId: string
  hostId: string
  runtimeFence: number
  spawnToken: string
  assertCurrent: () => void
  onIdentity: (identity: Readonly<AgentSessionProcessIdentity>) => Promise<void>
  onExit: (receipt: Readonly<{ pid: number | null }>) => Promise<void>
}
export async function openManagedPiProcessSupervisor(options: {
  pack: VerifiedManagedPiPack
  ownership: ManagedPiExecutionOwnership
  home: string
  startupTimeoutMs?: number
}) {
  const { pack, home } = options
  const caller = options.ownership
  if (
    !caller ||
    typeof caller.assertCurrent !== 'function' ||
    typeof caller.onIdentity !== 'function' ||
    typeof caller.onExit !== 'function'
  ) {
    throw new Error('hive_agent_capability_unavailable')
  }
  const ownership = Object.freeze({
    ...caller,
    assertCurrent: caller.assertCurrent.bind(caller),
    onIdentity: caller.onIdentity.bind(caller),
    onExit: caller.onExit.bind(caller)
  })
  const timeout = options.startupTimeoutMs ?? 5000
  if (
    !hiveAgentSessionIdSchema.safeParse(ownership.sessionId).success ||
    !isAgentSessionId(ownership.runtimeRecordId) ||
    ownership.hostId !== 'local' ||
    !Number.isSafeInteger(ownership.runtimeFence) ||
    ownership.runtimeFence < 1 ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(ownership.spawnToken) ||
    !isAbsolute(home) ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10000
  ) {
    throw new Error('hive_agent_capability_unavailable')
  }
  ownership.assertCurrent()
  const runtime = await verifyManagedPiRuntimeIdentity(pack)
  ownership.assertCurrent()
  runtime.assertCurrent()
  const spawnedAt = Date.now()
  const transport = new ManagedPiProcessTransport({
    files: pack.getLaunchFiles(),
    home,
    epoch: randomBytes(32).toString('hex'),
    sessionId: ownership.sessionId,
    spawnToken: ownership.spawnToken
  })
  let identity: Readonly<AgentSessionProcessIdentity> | undefined
  let reportedStartedAt: number | undefined
  let commitIdentity = Promise.resolve()
  let disposed = false
  const exitCallback = transport.exited.then(async () => {
    await commitIdentity.catch(() => {})
    await ownership.onExit(Object.freeze({ pid: transport.child.pid ?? null }))
  })
  void exitCallback.catch(() => transport.fail())
  const assertCurrent = () => {
    if (disposed) {
      throw new Error('hive_agent_capability_unavailable')
    }
    try {
      ownership.assertCurrent()
      runtime.assertCurrent()
      transport.assertCurrent()
    } catch {
      transport.fail()
      throw new Error('hive_agent_capability_unavailable')
    }
  }
  const checkIdentity = async (initial: boolean) => {
    assertCurrent()
    const challenge = randomUUID()
    const frame = await transport.exchange(
      initial
        ? { type: 'init', runtimeFence: ownership.runtimeFence, challenge }
        : { type: 'ping', challenge },
      'ready',
      (value) => value.challenge === challenge,
      timeout
    )
    assertCurrent()
    const actual = managedPiObject(frame.identity, [
      'schemaVersion',
      'nodeVersion',
      'piCoreVersion',
      'piAiVersion',
      'platform',
      'architecture',
      'toolPolicy',
      'protocols'
    ])
    if (
      frame.pid !== transport.child.pid ||
      frame.parentPid !== process.pid ||
      frame.spawnToken !== ownership.spawnToken ||
      frame.runtimeFence !== ownership.runtimeFence ||
      !Number.isSafeInteger(frame.startedAtMs) ||
      (initial
        ? (frame.startedAtMs as number) < spawnedAt - PROCESS_START_TIME_TOLERANCE_MS ||
          (frame.startedAtMs as number) > Date.now()
        : frame.startedAtMs !== reportedStartedAt) ||
      JSON.stringify(actual) !== JSON.stringify(runtime.identity)
    ) {
      throw new Error('hive_agent_pack_unavailable')
    }
    const observed = await managedPiDeadline(readProcessStartTimeMs(frame.pid as number), timeout)
    assertCurrent()
    if (
      observed !== null &&
      Math.abs(observed - (frame.startedAtMs as number)) > PROCESS_START_TIME_TOLERANCE_MS
    ) {
      throw new Error('hive_agent_outcome_unknown')
    }
    const processIdentity =
      identity ??
      Object.freeze({
        hostId: ownership.hostId,
        pid: frame.pid as number,
        processStartTimeMs: observed,
        spawnToken: ownership.spawnToken
      })
    const proof = await probeAgentSessionProcessIdentity({
      identity: processIdentity,
      deps: {
        readEchoedSpawnToken: async () => frame.spawnToken as string,
        readProcessStartTimeMs: async () => observed
      }
    })
    assertCurrent()
    if (proof.outcome !== 'identity-matched') {
      throw new Error('hive_agent_outcome_unknown')
    }
    reportedStartedAt = frame.startedAtMs as number
    return processIdentity
  }
  let checking = Promise.resolve()
  const verify = (initial = false) => {
    const result = checking.then(() => checkIdentity(initial))
    checking = result.then(
      () => {},
      () => {}
    )
    return result
  }
  const dispose = async () => {
    disposed = true
    await transport.stop()
    await managedPiDeadline(exitCallback, timeout)
  }
  try {
    identity = await verify(true)
    assertCurrent()
    commitIdentity = ownership.onIdentity(identity)
    await managedPiDeadline(commitIdentity, timeout)
    assertCurrent()
    return Object.freeze({ transport, identity, ownership, assertCurrent, verify, dispose })
  } catch {
    await dispose()
    throw new Error('hive_agent_capability_unavailable')
  }
}
