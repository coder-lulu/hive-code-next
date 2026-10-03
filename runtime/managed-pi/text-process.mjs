import {
  managedPiObject,
  managedPiScope,
  managedPiSequence,
  parseManagedPiTextRequest,
  parseManagedPiInferenceEvent
} from '../../src/shared/managed-pi-process-protocol.ts'

/** Private channel only; the parent owns inference authorization and persistence. */
export function startManagedPiTextProcess(runtime) {
  if (typeof process.send !== 'function' || !process.env.ORCA_AGENT_SESSION_SPAWN_TOKEN) {
    throw new Error('hive_agent_capability_unavailable')
  }
  let epoch, sessionId, runtimeFence, active
  const startedAtMs = Math.round(Date.now() - process.uptime() * 1000)
  const send = (frame) =>
    new Promise((resolve, reject) => {
      process.send({ epoch, sessionId, ...frame }, (error) => {
        if (error) {
          reject(new Error('hive_agent_outcome_unknown'))
        } else {
          resolve()
        }
      })
    })
  const ready = (challenge) =>
    send({
      type: 'ready',
      challenge,
      runtimeFence,
      pid: process.pid,
      parentPid: process.ppid,
      startedAtMs,
      spawnToken: process.env.ORCA_AGENT_SESSION_SPAWN_TOKEN,
      identity: runtime.getManagedPiRuntimeIdentity()
    })
  const stop = () => {
    active?.control.abort()
    process.exit(0)
  }
  const generate = async (request) => {
    const control = new AbortController()
    const stream = runtime.createAssistantMessageEventStream()
    const waits = new Map()
    const run = {
      request,
      control,
      stream,
      waits,
      inferenceSequence: 0,
      outputSequence: 0,
      terminal: false,
      text: '',
      bytes: 0
    }
    active = run
    control.signal.addEventListener(
      'abort',
      () => {
        if (run.message) {
          stream.push({
            type: 'error',
            reason: 'aborted',
            error: { ...run.message(run.text), stopReason: 'aborted' }
          })
        }
        stream.end()
        for (const finish of waits.values()) {
          finish()
        }
        waits.clear()
      },
      { once: true }
    )
    let outcome = 'unknown'
    try {
      const kernel = runtime.runManagedTextGeneration({
        input: { ...request, signal: control.signal },
        streamFn: async (model) => {
          const message = (text) => ({
            role: 'assistant',
            content: [{ type: 'text', text }],
            api: model.api,
            model: model.id,
            provider: model.provider,
            stopReason: 'stop',
            timestamp: Date.now(),
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
            }
          })
          run.message = message
          stream.push({ type: 'start', partial: message('') })
          await send({ type: 'inference.open', generationId: request.generationId })
          return {
            result: () => stream.result(),
            async *[Symbol.asyncIterator]() {
              for await (const event of stream) {
                try {
                  yield event
                } finally {
                  if (event.type !== 'start' && !control.signal.aborted) {
                    await send({
                      type: 'inference.ack',
                      generationId: request.generationId,
                      sequence: event.hiveSequence
                    })
                  }
                }
              }
            }
          }
        }
      })
      for await (const event of kernel) {
        if (control.signal.aborted) {
          break
        }
        const acknowledged = new Promise((resolve) => waits.set(event.sequence, resolve))
        run.outputSequence = event.sequence
        await send({ type: 'output', generationId: request.generationId, event })
        await acknowledged
        if (event.type === 'completed') {
          outcome = 'completed'
        }
      }
      if (control.signal.aborted) {
        outcome = 'cancelled'
      }
    } catch {
      if (control.signal.aborted) {
        outcome = 'cancelled'
      }
    } finally {
      control.abort()
      if (active === run) {
        active = undefined
      }
      await send({ type: 'idle', generationId: request.generationId, outcome })
    }
  }
  process.on('message', (value) => {
    try {
      if (!epoch) {
        const frame = managedPiObject(value, [
          'type',
          'epoch',
          'sessionId',
          'runtimeFence',
          'challenge'
        ])
        if (
          frame.type !== 'init' ||
          !/^[a-f0-9]{64}$/.test(frame.epoch) ||
          typeof frame.sessionId !== 'string' ||
          !Number.isSafeInteger(frame.runtimeFence) ||
          frame.runtimeFence < 1 ||
          typeof frame.challenge !== 'string'
        ) {
          throw new Error('invalid init')
        }
        ;({ epoch, sessionId, runtimeFence } = frame)
        void ready(frame.challenge).catch(stop)
        return
      }
      if (value.type === 'ping') {
        const frame = managedPiObject(value, ['type', 'epoch', 'sessionId', 'challenge'])
        managedPiScope(frame, epoch, sessionId)
        if (typeof frame.challenge !== 'string') {
          throw new Error('invalid ping')
        }
        void ready(frame.challenge).catch(stop)
      } else if (value.type === 'run') {
        const frame = managedPiObject(value, ['type', 'epoch', 'sessionId', 'request'])
        managedPiScope(frame, epoch, sessionId)
        const request = parseManagedPiTextRequest(frame.request)
        if (active || request.sessionId !== sessionId) {
          throw new Error('invalid run')
        }
        void generate(request).catch(stop)
      } else if (value.type === 'shutdown') {
        const frame = managedPiObject(value, ['type', 'epoch', 'sessionId'])
        managedPiScope(frame, epoch, sessionId)
        stop()
      } else {
        const fields =
          value.type === 'cancel'
            ? []
            : value.type === 'output.ack'
              ? ['sequence']
              : ['sequence', 'event']
        const frame = managedPiObject(value, [
          'type',
          'epoch',
          'sessionId',
          'generationId',
          ...fields
        ])
        if (!active) {
          throw new Error('no active generation')
        }
        managedPiScope(frame, epoch, sessionId, active.request.generationId)
        if (frame.type === 'cancel') {
          active.control.abort()
        } else if (frame.type === 'output.ack') {
          const sequence = managedPiSequence(frame.sequence),
            finish = active.waits.get(sequence)
          if (!finish || sequence !== active.outputSequence) {
            throw new Error('invalid output ack')
          }
          active.waits.delete(sequence)
          finish()
        } else if (frame.type === 'inference.event') {
          const sequence = managedPiSequence(frame.sequence)
          if (
            active.terminal ||
            sequence !== ++active.inferenceSequence ||
            active.control.signal.aborted ||
            !active.message
          ) {
            throw new Error('invalid inference order')
          }
          const event = parseManagedPiInferenceEvent(frame.event)
          if (event.type === 'text') {
            active.bytes += Buffer.byteLength(event.text)
            if (active.bytes > 1024 * 1024 || sequence > 999) {
              throw new Error('output bound')
            }
            active.text += event.text
            active.stream.push({
              type: 'text_delta',
              contentIndex: 0,
              delta: event.text,
              partial: active.message(active.text),
              hiveSequence: sequence
            })
          } else {
            active.terminal = true
            active.stream.push({
              type: 'done',
              reason: 'stop',
              message: active.message(event.text),
              hiveSequence: sequence
            })
            active.stream.end()
          }
        } else {
          throw new Error('unsupported frame')
        }
      }
    } catch {
      stop()
    }
  })
  process.on('disconnect', stop)
}
