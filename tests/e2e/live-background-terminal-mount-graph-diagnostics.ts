import type { ElectronApplication } from '@stablyai/playwright-test'

type PublicationEntry = {
  sequence: number
  channel: string
  startedAt: number
  input: unknown
  result?: unknown
  error?: string
  settledAt?: number
}

export async function installRuntimeSurfacePublicationSpy(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis as unknown as {
      __runtimeSurfacePublicationLog?: PublicationEntry[]
    }
    if (state.__runtimeSurfacePublicationLog) {
      return
    }
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, args: unknown) => unknown>
      }
    )._invokeHandlers
    if (!handlers) {
      throw new Error('Runtime IPC handlers unavailable for publication diagnostics')
    }
    state.__runtimeSurfacePublicationLog = []
    let sequence = 0
    const snapshot = (value: unknown): unknown => {
      try {
        return value === undefined ? null : JSON.parse(JSON.stringify(value))
      } catch (error) {
        return { serializationError: String(error) }
      }
    }
    for (const channel of ['runtime:syncWindowGraph', 'runtime:call', 'pty:listSessions']) {
      const handler = handlers.get(channel)
      if (!handler) {
        throw new Error(`Missing ${channel} handler for publication diagnostics`)
      }
      handlers.set(channel, (event, args) => {
        if (
          channel === 'runtime:call' &&
          (!args ||
            typeof args !== 'object' ||
            !('method' in args) ||
            typeof args.method !== 'string' ||
            !['terminal.list', 'session.tabs.list', 'session.tabs.listAll'].includes(args.method))
        ) {
          return handler(event, args)
        }
        const entry: PublicationEntry = {
          sequence: ++sequence,
          channel,
          startedAt: Date.now(),
          input: snapshot(args)
        }
        state.__runtimeSurfacePublicationLog!.push(entry)
        if (state.__runtimeSurfacePublicationLog!.length > 300) {
          state.__runtimeSurfacePublicationLog!.shift()
        }
        const settle = (result: unknown): unknown => {
          entry.result = snapshot(result)
          entry.settledAt = Date.now()
          return result
        }
        const failed = (error: unknown): never => {
          entry.error = String(error)
          entry.settledAt = Date.now()
          throw error
        }
        try {
          const result = handler(event, args)
          return result instanceof Promise ? result.then(settle, failed) : settle(result)
        } catch (error) {
          return failed(error)
        }
      })
    }
  })
}

export async function withRuntimeSurfacePublicationDiagnostic(
  app: ElectronApplication,
  assertion: () => Promise<void>
): Promise<void> {
  try {
    await assertion()
  } catch (failure) {
    try {
      const timeline = await app.evaluate(() => {
        const state = globalThis as unknown as {
          __runtimeSurfacePublicationLog?: PublicationEntry[]
        }
        return state.__runtimeSurfacePublicationLog ?? []
      })
      for (const entry of timeline) {
        console.log('RUNTIME_SURFACE_PUBLICATION_DIAGNOSTIC', JSON.stringify(entry))
      }
    } catch (error) {
      console.log('RUNTIME_SURFACE_PUBLICATION_DIAGNOSTIC_ERROR', String(error))
    }
    throw failure
  }
}
