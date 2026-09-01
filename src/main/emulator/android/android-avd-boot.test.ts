import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { AndroidCommandResult, AndroidCommandRunner } from './android-command-runner'
import type { AndroidSdkPaths } from './android-sdk-discovery'
import {
  AndroidManagedAvdProcesses,
  type AndroidAvdProcessSpawner
} from './android-managed-avd-processes'
import { bootAndroidDevice } from './android-avd-boot'

const SDK: AndroidSdkPaths = {
  sdkRoot: '/sdk',
  adb: '/sdk/adb',
  emulator: '/sdk/emulator',
  avdmanager: '/sdk/avdmanager'
}

const ok = (stdout = ''): AndroidCommandResult => ({ stdout, stderr: '', code: 0 })
const adbDevices = (...serials: string[]): AndroidCommandResult =>
  ok(['List of devices attached', ...serials.map((serial) => `${serial}\tdevice`)].join('\n'))

function fakeChild(pid: number): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    unref: vi.fn(),
    kill: vi.fn(() => true)
  }) as unknown as ChildProcess
}

function bootOptions(
  managedAvds: AndroidManagedAvdProcesses,
  overrides: Partial<{
    bootTimeoutMs: number
    pollIntervalMs: number
    sleep: (ms: number) => Promise<void>
  }> = {}
) {
  return {
    bootTimeoutMs: overrides.bootTimeoutMs ?? 20,
    pollIntervalMs: overrides.pollIntervalMs ?? 1,
    sleep: overrides.sleep ?? (async () => {}),
    managedAvds
  }
}

describe('bootAndroidDevice recovery', () => {
  it('fails immediately with captured output when the launched emulator exits', async () => {
    const child = fakeChild(7_001)
    const spawn = vi.fn(() => {
      queueMicrotask(() => {
        child.stderr?.emit('data', 'ERROR | AVD lock is already held')
        child.emit('exit', 2, null)
      })
      return child
    })
    const managed = new AndroidManagedAvdProcesses(
      spawn as unknown as AndroidAvdProcessSpawner,
      vi.fn(async () => true)
    )
    const runner = vi.fn(async (binary: string, args: readonly string[]) => {
      if (binary === SDK.adb && args.join(' ') === 'devices -l') {
        return adbDevices()
      }
      if (binary === SDK.emulator && args.join(' ') === '-list-avds') {
        return ok('Pixel_7')
      }
      return ok()
    })
    const sleep = vi.fn(async () => {})

    await expect(
      bootAndroidDevice(
        runner as unknown as AndroidCommandRunner,
        SDK,
        'Pixel_7',
        bootOptions(managed, { bootTimeoutMs: 1_000, pollIntervalMs: 10, sleep })
      )
    ).rejects.toMatchObject({
      code: 'emulator_helper_failed',
      message: expect.stringContaining('AVD lock is already held')
    })
    expect(sleep.mock.calls.length).toBeLessThan(5)
  })

  it('cold-restarts one unresponsive managed AVD and binds its replacement serial', async () => {
    let phase: 'running' | 'gone' | 'restarted' = 'running'
    const children = [fakeChild(7_001), fakeChild(7_002)]
    const spawn = vi.fn(() => {
      const child = children[spawn.mock.calls.length - 1]
      if (spawn.mock.calls.length === 2) {
        phase = 'restarted'
      }
      return child
    })
    const terminateTree = vi.fn(async () => {
      phase = 'gone'
      return true
    })
    const managed = new AndroidManagedAvdProcesses(
      spawn as unknown as AndroidAvdProcessSpawner,
      terminateTree
    )
    const first = managed.launch(SDK.emulator, 'Pixel_7')
    managed.bindSerial(first, 'emulator-5554')
    const runner = vi.fn(async (binary: string, args: readonly string[]) => {
      const joinedArgs = args.join(' ')
      if (binary === SDK.adb && joinedArgs === 'devices -l') {
        if (phase === 'running') {
          return adbDevices('emulator-5554')
        }
        if (phase === 'restarted') {
          return adbDevices('emulator-5556')
        }
        return adbDevices()
      }
      if (joinedArgs === '-s emulator-5554 emu avd name') {
        return { stdout: '', stderr: 'command timed out', code: 1 }
      }
      if (joinedArgs === '-s emulator-5554 shell getprop sys.boot_completed') {
        return { stdout: '', stderr: 'command timed out', code: 1 }
      }
      if (joinedArgs === '-s emulator-5556 shell getprop sys.boot_completed') {
        return ok('1')
      }
      return ok()
    })

    await expect(
      bootAndroidDevice(
        runner as unknown as AndroidCommandRunner,
        SDK,
        'Pixel_7',
        bootOptions(managed)
      )
    ).resolves.toBe('emulator-5556')

    expect(terminateTree).toHaveBeenCalledTimes(1)
    expect(terminateTree).toHaveBeenCalledWith(first.child)
    expect(spawn).toHaveBeenCalledTimes(2)
    const spawnCalls = spawn.mock.calls as unknown as [{ args?: readonly string[] }][]
    expect(spawnCalls[1]?.[0]).toEqual(
      expect.objectContaining({
        args: ['-avd', 'Pixel_7', '-no-snapshot-load', '-no-window']
      })
    )
    expect(managed.findBySerial('emulator-5556')?.avdName).toBe('Pixel_7')
  })

  it('does not launch a duplicate when an external unresponsive emulator hides its AVD name', async () => {
    const spawn = vi.fn(() => fakeChild(7_001))
    const terminateTree = vi.fn(async () => true)
    const managed = new AndroidManagedAvdProcesses(
      spawn as unknown as AndroidAvdProcessSpawner,
      terminateTree
    )
    const runner = vi.fn(async (binary: string, args: readonly string[]) => {
      const joinedArgs = args.join(' ')
      if (binary === SDK.adb && joinedArgs === 'devices -l') {
        return ok('List of devices attached\nemulator-5554\toffline')
      }
      if (binary === SDK.emulator && joinedArgs === '-list-avds') {
        return ok('Pixel_7')
      }
      if (joinedArgs === '-s emulator-5554 emu avd name') {
        return { stdout: '', stderr: 'command timed out', code: 1 }
      }
      if (joinedArgs === '-s emulator-5554 shell getprop sys.boot_completed') {
        return { stdout: '', stderr: 'command timed out', code: 1 }
      }
      return ok()
    })

    await expect(
      bootAndroidDevice(
        runner as unknown as AndroidCommandRunner,
        SDK,
        'Pixel_7',
        bootOptions(managed)
      )
    ).rejects.toMatchObject({ code: 'emulator_device_unresponsive' })
    expect(spawn).not.toHaveBeenCalled()
    expect(terminateTree).not.toHaveBeenCalled()
  })

  it('does not launch a duplicate while an unidentified external emulator is booting', async () => {
    const spawn = vi.fn(() => fakeChild(7_001))
    const managed = new AndroidManagedAvdProcesses(
      spawn as unknown as AndroidAvdProcessSpawner,
      vi.fn(async () => true)
    )
    const runner = vi.fn(async (binary: string, args: readonly string[]) => {
      const joinedArgs = args.join(' ')
      if (binary === SDK.adb && joinedArgs === 'devices -l') {
        return adbDevices('emulator-5554')
      }
      if (binary === SDK.emulator && joinedArgs === '-list-avds') {
        return ok('Pixel_7')
      }
      if (joinedArgs === '-s emulator-5554 shell getprop sys.boot_completed') {
        return ok('0')
      }
      return ok('')
    })

    await expect(
      bootAndroidDevice(
        runner as unknown as AndroidCommandRunner,
        SDK,
        'Pixel_7',
        bootOptions(managed)
      )
    ).rejects.toMatchObject({
      code: 'emulator_helper_failed',
      message: expect.stringContaining('possible duplicate')
    })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('stops after one cold restart when the replacement also becomes unresponsive', async () => {
    let phase: 'running' | 'gone' | 'restarted' = 'running'
    const children = [fakeChild(7_001), fakeChild(7_002)]
    const spawn = vi.fn(() => {
      const child = children[spawn.mock.calls.length - 1]
      if (spawn.mock.calls.length === 2) {
        phase = 'restarted'
      }
      return child
    })
    const terminateTree = vi.fn(async () => {
      phase = 'gone'
      return true
    })
    const managed = new AndroidManagedAvdProcesses(
      spawn as unknown as AndroidAvdProcessSpawner,
      terminateTree
    )
    const first = managed.launch(SDK.emulator, 'Pixel_7')
    managed.bindSerial(first, 'emulator-5554')
    const runner = vi.fn(async (binary: string, args: readonly string[]) => {
      const joinedArgs = args.join(' ')
      if (binary === SDK.adb && joinedArgs === 'devices -l') {
        if (phase === 'running') {
          return adbDevices('emulator-5554')
        }
        if (phase === 'restarted') {
          return adbDevices('emulator-5556')
        }
        return adbDevices()
      }
      if (joinedArgs.endsWith('emu avd name')) {
        return ok('Pixel_7\nOK')
      }
      if (joinedArgs.endsWith('shell getprop sys.boot_completed')) {
        return { stdout: '', stderr: 'command timed out', code: 1 }
      }
      return ok()
    })

    await expect(
      bootAndroidDevice(
        runner as unknown as AndroidCommandRunner,
        SDK,
        'Pixel_7',
        bootOptions(managed)
      )
    ).rejects.toMatchObject({
      code: 'emulator_device_unresponsive',
      message: expect.stringContaining('restarted it once')
    })
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(terminateTree).toHaveBeenCalledTimes(2)
  })

  it('terminates a managed child when its boot deadline expires', async () => {
    const child = fakeChild(7_001)
    const spawn = vi.fn(() => child)
    const terminateTree = vi.fn(async () => true)
    const managed = new AndroidManagedAvdProcesses(
      spawn as unknown as AndroidAvdProcessSpawner,
      terminateTree
    )
    const runner = vi.fn(async (binary: string, args: readonly string[]) => {
      if (binary === SDK.adb && args.join(' ') === 'devices -l') {
        return adbDevices()
      }
      if (binary === SDK.emulator && args.join(' ') === '-list-avds') {
        return ok('Pixel_7')
      }
      return ok()
    })

    await expect(
      bootAndroidDevice(
        runner as unknown as AndroidCommandRunner,
        SDK,
        'Pixel_7',
        bootOptions(managed, { bootTimeoutMs: 2, pollIntervalMs: 1 })
      )
    ).rejects.toMatchObject({ code: 'emulator_helper_failed' })
    expect(terminateTree).toHaveBeenCalledTimes(1)
    expect(terminateTree).toHaveBeenCalledWith(child)
    expect(managed.findByName('Pixel_7')).toBeNull()
  })
})
