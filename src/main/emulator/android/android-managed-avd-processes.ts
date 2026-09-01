import {
  spawnProcess,
  type ChildProcessHandle,
  type ProcessSpec
} from '../../../shared/child-process/run-process'
import { forceTerminateProcessTree } from '../../../shared/child-process/process-tree-termination'
import { bootAvdArgs } from './avd-manager'

const MAX_LAUNCH_OUTPUT_BYTES = 16 * 1024

export type AndroidManagedAvdExit = {
  code: number | null
  signal: NodeJS.Signals | null
  error?: Error
}

export type AndroidManagedAvdProcess = {
  readonly avdName: string
  readonly child: ChildProcessHandle
  serial: string | null
  exitResult: AndroidManagedAvdExit | null
  readonly exit: Promise<AndroidManagedAvdExit>
  output(): string
}

export type AndroidAvdProcessSpawner = (spec: ProcessSpec) => ChildProcessHandle
export type AndroidAvdProcessTerminator = (child: ChildProcessHandle) => Promise<boolean>

/** Tracks only emulator processes launched by this HiveCode main process. */
export class AndroidManagedAvdProcesses {
  private readonly byName = new Map<string, AndroidManagedAvdProcess>()

  constructor(
    private readonly spawn: AndroidAvdProcessSpawner = spawnProcess,
    private readonly terminateTree: AndroidAvdProcessTerminator = forceTerminateProcessTree
  ) {}

  launch(
    emulatorPath: string,
    avdName: string,
    options: { coldBoot?: boolean } = {}
  ): AndroidManagedAvdProcess {
    const existing = this.byName.get(avdName)
    if (existing && !existing.exitResult) {
      return existing
    }

    const child = this.spawn({
      program: emulatorPath,
      args: bootAvdArgs(avdName, {
        noWindow: true,
        noSnapshotLoad: options.coldBoot
      }),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = Buffer.alloc(0)
    let resolveExit!: (result: AndroidManagedAvdExit) => void
    const record: AndroidManagedAvdProcess = {
      avdName,
      child,
      serial: null,
      exitResult: null,
      exit: new Promise<AndroidManagedAvdExit>((resolve) => {
        resolveExit = resolve
      }),
      output: () => output.toString('utf8').trim()
    }

    const appendOutput = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      output = Buffer.concat([output, bytes])
      if (output.length > MAX_LAUNCH_OUTPUT_BYTES) {
        output = output.subarray(output.length - MAX_LAUNCH_OUTPUT_BYTES)
      }
    }
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream?.on('error', () => {})
    }

    let settled = false
    const finish = (result: AndroidManagedAvdExit): void => {
      if (settled) {
        return
      }
      settled = true
      record.exitResult = result
      if (this.byName.get(avdName) === record) {
        this.byName.delete(avdName)
      }
      resolveExit(result)
    }
    child.once('error', (error) => finish({ code: null, signal: null, error }))
    child.once('exit', (code, signal) => finish({ code, signal }))
    child.unref()
    unrefStream(child.stdout)
    unrefStream(child.stderr)

    this.byName.set(avdName, record)
    return record
  }

  bindSerial(record: AndroidManagedAvdProcess, serial: string): void {
    if (!record.exitResult) {
      record.serial = serial
    }
  }

  findByName(avdName: string): AndroidManagedAvdProcess | null {
    const record = this.byName.get(avdName)
    return record && !record.exitResult ? record : null
  }

  findBySerial(serial: string): AndroidManagedAvdProcess | null {
    for (const record of this.byName.values()) {
      if (!record.exitResult && record.serial === serial) {
        return record
      }
    }
    return null
  }

  namesBySerial(): Map<string, string> {
    const names = new Map<string, string>()
    for (const record of this.byName.values()) {
      if (!record.exitResult && record.serial) {
        names.set(record.serial, record.avdName)
      }
    }
    return names
  }

  async terminate(record: AndroidManagedAvdProcess): Promise<boolean> {
    if (record.exitResult) {
      return true
    }
    const terminated = await this.terminateTree(record.child).catch(() => false)
    if (terminated && this.byName.get(record.avdName) === record) {
      this.byName.delete(record.avdName)
    }
    return terminated
  }

  async dispose(): Promise<void> {
    const records = [...this.byName.values()]
    await Promise.all(records.map((record) => this.terminate(record)))
  }
}

function unrefStream(stream: NodeJS.ReadableStream | null): void {
  const unrefable = stream as (NodeJS.ReadableStream & { unref?: () => void }) | null
  unrefable?.unref?.()
}
