import {
  managedPiObject,
  managedPiScope,
  managedPiSequence,
  managedPiText,
  parseManagedPiTextRequest
} from '../../shared/managed-pi-process-protocol'
import { openManagedPiProcessSupervisor } from '../runtime/managed-pi-process-supervisor'
import { pumpManagedPiInference, type ManagedPiTextInference } from './managed-pi-inference-pump'
import type { ManagedPiTextDriver } from './managed-pi-text-adapter'
import type { HiveAgentTextEvent } from './hive-agent-text-adapter'

export async function createManagedPiTextDriver(
  options: Parameters<typeof openManagedPiProcessSupervisor>[0] & {
    inference: ManagedPiTextInference
    turnTimeoutMs?: number
  }
) {
  const timeout = options.turnTimeoutMs ?? 120000
  const { pack } = options
  if (
    !options.inference ||
    typeof options.inference.run !== 'function' ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120000
  ) {
    throw new Error('hive_agent_capability_unavailable')
  }
  const inference = { run: options.inference.run.bind(options.inference) }
  const supervisor = await openManagedPiProcessSupervisor(options)
  let active = false
  let activeControl: AbortController | undefined
  void supervisor.transport.failure.catch(() => activeControl?.abort())
  const dispose = async () => {
    activeControl?.abort()
    await supervisor.dispose()
  }
  const driver: ManagedPiTextDriver = {
    async *run(raw) {
      const { launchFiles, signal, ...rest } = raw
      const request = parseManagedPiTextRequest(rest)
      supervisor.assertCurrent()
      const files = pack.getLaunchFiles()
      if (
        active ||
        request.sessionId !== supervisor.ownership.sessionId ||
        !(signal instanceof AbortSignal) ||
        launchFiles.node !== files.node ||
        launchFiles.runner !== files.runner
      ) {
        throw new Error('hive_agent_capability_unavailable')
      }
      if (signal.aborted) {
        return
      }
      active = true
      const control = new AbortController()
      activeControl = control
      let wake!: (event: HiveAgentTextEvent) => void
      let pending: HiveAgentTextEvent | undefined
      let next = new Promise<HiveAgentTextEvent>((resolve) => {
        wake = resolve
      })
      let opened!: () => void
      const open = new Promise<void>((resolve) => {
        opened = resolve
      })
      let finish!: (outcome: unknown) => void
      const idle = new Promise<unknown>((resolve) => {
        finish = resolve
      })
      let openSeen = false,
        idleSeen = false,
        sequence = 0,
        bytes = 0,
        completed = false
      const abort = () => {
        control.abort()
        supervisor.transport.fail()
      }
      const deadline = setTimeout(abort, timeout)
      control.signal.addEventListener('abort', () => clearTimeout(deadline), { once: true })
      signal.addEventListener('abort', abort, { once: true })
      const assertCurrent = () => {
        supervisor.assertCurrent()
        if (control.signal.aborted) {
          throw new Error('hive_agent_outcome_unknown')
        }
      }
      const unlisten = supervisor.transport.listen((frame) => {
        if (frame.type === 'ready' || frame.type === 'inference.ack') {
          return
        }
        assertCurrent()
        managedPiScope(frame, supervisor.transport.epoch, request.sessionId, request.generationId)
        if (idleSeen) {
          throw new Error('late frame')
        }
        if (frame.type === 'inference.open') {
          if (openSeen) {
            throw new Error('repeated inference')
          }
          openSeen = true
          opened()
        } else if (frame.type === 'idle') {
          idleSeen = true
          finish(frame.outcome)
        } else if (frame.type === 'output') {
          if (!openSeen || pending || completed) {
            throw new Error('invalid output order')
          }
          const kind = (frame.event as { type?: string } | null)?.type
          const value = managedPiObject(
            frame.event,
            kind === 'text' ? ['sequence', 'type', 'text'] : ['sequence', 'type']
          )
          if (managedPiSequence(value.sequence) !== ++sequence) {
            throw new Error('event gap')
          }
          let event: HiveAgentTextEvent
          if (kind === 'text') {
            const text = managedPiText(value.text)
            bytes += Buffer.byteLength(text)
            if (bytes > 1024 * 1024 || sequence > 999) {
              throw new Error('output limit')
            }
            event = Object.freeze({ sequence, type: 'text', text })
          } else if (kind === 'completed') {
            completed = true
            event = Object.freeze({ sequence, type: 'completed' })
          } else {
            throw new Error('unsupported output')
          }
          pending = event
          wake(event)
        } else {
          throw new Error('unsupported frame')
        }
      })
      const race = <T>(promise: Promise<T>) =>
        supervisor.transport.wait(promise, timeout, control.signal)
      const pump = race(
        (async () => {
          await open
          assertCurrent()
          await pumpManagedPiInference({
            request,
            signal: control.signal,
            transport: supervisor.transport,
            inference,
            assertCurrent,
            timeoutMs: timeout
          })
        })()
      )
      void pump.catch(() => supervisor.transport.fail())
      let success = false
      try {
        await supervisor.verify()
        assertCurrent()
        await supervisor.transport.send({ type: 'run', request })
        while (true) {
          const event = await race(
            Promise.race([
              next,
              idle.then(() => {
                throw new Error('missing output')
              })
            ])
          )
          assertCurrent()
          if (event.type === 'text') {
            try {
              yield event
            } finally {
              pending = undefined
              next = new Promise((resolve) => {
                wake = resolve
              })
              if (!control.signal.aborted) {
                await supervisor.transport.send({
                  type: 'output.ack',
                  generationId: request.generationId,
                  sequence: event.sequence
                })
              }
            }
          } else {
            pending = undefined
            await supervisor.transport.send({
              type: 'output.ack',
              generationId: request.generationId,
              sequence: event.sequence
            })
            const outcome = await race(idle)
            await pump
            assertCurrent()
            if (outcome !== 'completed') {
              throw new Error('invalid final evidence')
            }
            success = true
            clearTimeout(deadline)
            yield event
            return
          }
        }
      } catch {
        throw new Error('hive_agent_outcome_unknown')
      } finally {
        control.abort()
        activeControl = undefined
        unlisten()
        signal.removeEventListener('abort', abort)
        if (!success) {
          await supervisor.dispose()
        }
        active = false
      }
    }
  }
  return Object.freeze({
    ...driver,
    identity: supervisor.identity,
    assertCurrent: supervisor.assertCurrent,
    verify: supervisor.verify,
    dispose
  })
}
