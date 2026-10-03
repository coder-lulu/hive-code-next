import { describe, expect, it, vi } from 'vitest'
import type { AndroidCommandResult, AndroidCommandRunner } from './android-command-runner'
import type { AndroidSdkPaths } from './android-sdk-discovery'
import {
  findRunningAvdSerial,
  listAndroidDevices,
  mergeAndroidDevices
} from './android-device-inventory'
import { parseAdbDevices } from './adb-devices'

const SDK: AndroidSdkPaths = {
  sdkRoot: '/sdk',
  adb: '/sdk/adb',
  emulator: '/sdk/emulator',
  avdmanager: '/sdk/avdmanager'
}

const ok = (stdout: string): AndroidCommandResult => ({ stdout, stderr: '', code: 0 })

function runner(handler: (binary: string, joinedArgs: string) => string): AndroidCommandRunner {
  return (async (binary: string, args: readonly string[]) =>
    ok(handler(binary, args.join(' ')))) as unknown as AndroidCommandRunner
}

describe('mergeAndroidDevices', () => {
  it('labels running emulators by AVD name and lists unbooted AVDs as shutdown', () => {
    const running = parseAdbDevices('List of devices attached\nemulator-5554\tdevice model:Pixel_7')
    const devices = mergeAndroidDevices(
      running,
      ['Pixel_7', 'Pixel_Tablet'],
      new Map([['emulator-5554', 'Pixel_7']])
    )
    expect(devices).toEqual([
      {
        backend: 'android',
        id: 'emulator-5554',
        name: 'Pixel_7',
        state: 'booted',
        detail: 'emulator',
        isAvailable: true
      },
      {
        backend: 'android',
        id: 'Pixel_Tablet',
        name: 'Pixel_Tablet',
        state: 'shutdown',
        detail: 'avd',
        isAvailable: true
      }
    ])
  })

  it('falls back to the model then serial for unnamed physical devices', () => {
    const running = parseAdbDevices('List of devices attached\nABC123\tdevice model:Pixel_8')
    const devices = mergeAndroidDevices(running, [], new Map())
    expect(devices[0]).toMatchObject({ id: 'ABC123', name: 'Pixel_8', detail: 'device' })
  })
})

describe('listAndroidDevices', () => {
  it('queries adb + emulator and resolves running AVD names', async () => {
    const fake = vi.fn(
      runner((binary, a) => {
        if (binary === SDK.adb && a === 'devices -l') {
          return 'List of devices attached\nemulator-5554\tdevice'
        }
        if (binary === SDK.emulator && a === '-list-avds') {
          return 'Pixel_7'
        }
        if (binary === SDK.adb && a === '-s emulator-5554 emu avd name') {
          return 'Pixel_7\nOK'
        }
        if (binary === SDK.adb && a === '-s emulator-5554 shell getprop sys.boot_completed') {
          return '1'
        }
        return ''
      })
    )
    const devices = await listAndroidDevices(fake as unknown as AndroidCommandRunner, SDK)
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({ id: 'emulator-5554', name: 'Pixel_7', state: 'booted' })
  })

  it('classifies adb-visible transports by Android framework health', async () => {
    const fake = vi.fn(async (binary: string, args: readonly string[]) => {
      const joinedArgs = args.join(' ')
      if (binary === SDK.adb && joinedArgs === 'devices -l') {
        return ok(
          [
            'List of devices attached',
            'emulator-5554\tdevice',
            'emulator-5556\tdevice',
            'emulator-5558\tdevice'
          ].join('\n')
        )
      }
      if (binary === SDK.emulator && joinedArgs === '-list-avds') {
        return ok('Ready\nStarting\nStuck')
      }
      if (binary === SDK.adb && joinedArgs.endsWith('emu avd name')) {
        const names: Record<string, string> = {
          'emulator-5554': 'Ready',
          'emulator-5556': 'Starting',
          'emulator-5558': 'Stuck'
        }
        return ok(`${names[args[1]]}\nOK`)
      }
      if (joinedArgs === '-s emulator-5554 shell getprop sys.boot_completed') {
        return ok('1')
      }
      if (joinedArgs === '-s emulator-5556 shell getprop sys.boot_completed') {
        return ok('0')
      }
      if (joinedArgs === '-s emulator-5558 shell getprop sys.boot_completed') {
        return { stdout: '', stderr: 'command timed out', code: 1 }
      }
      return ok('')
    })

    const devices = await listAndroidDevices(fake as unknown as AndroidCommandRunner, SDK)

    expect(devices).toEqual([
      expect.objectContaining({ id: 'emulator-5554', name: 'Ready', state: 'booted' }),
      expect.objectContaining({ id: 'emulator-5556', name: 'Starting', state: 'booting' }),
      expect.objectContaining({ id: 'emulator-5558', name: 'Stuck', state: 'unresponsive' })
    ])
    for (const serial of ['emulator-5554', 'emulator-5556', 'emulator-5558']) {
      expect(fake).toHaveBeenCalledWith(
        SDK.adb,
        ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
        { timeoutMs: 5_000 }
      )
    }
  })

  it('uses a managed serial identity to dedupe an AVD when its name probe fails', async () => {
    const fake = vi.fn(async (binary: string, args: readonly string[]) => {
      const joinedArgs = args.join(' ')
      if (binary === SDK.adb && joinedArgs === 'devices -l') {
        return ok('List of devices attached\nemulator-5554\tdevice')
      }
      if (binary === SDK.emulator && joinedArgs === '-list-avds') {
        return ok('Pixel_7')
      }
      if (joinedArgs === '-s emulator-5554 emu avd name') {
        return { stdout: '', stderr: 'command timed out', code: 1 }
      }
      if (joinedArgs === '-s emulator-5554 shell getprop sys.boot_completed') {
        return ok('1')
      }
      return ok('')
    })

    const devices = await listAndroidDevices(
      fake as unknown as AndroidCommandRunner,
      SDK,
      new Map([['emulator-5554', 'Pixel_7']])
    )

    expect(devices).toEqual([
      expect.objectContaining({ id: 'emulator-5554', name: 'Pixel_7', state: 'booted' })
    ])
    expect(fake).toHaveBeenCalledWith(SDK.adb, ['-s', 'emulator-5554', 'emu', 'avd', 'name'], {
      timeoutMs: 5_000
    })
  })

  it('keeps an offline emulator transport visible as unresponsive', async () => {
    const fake = vi.fn(async (binary: string, args: readonly string[]) => {
      const joinedArgs = args.join(' ')
      if (binary === SDK.adb && joinedArgs === 'devices -l') {
        return ok('List of devices attached\nemulator-5554\toffline')
      }
      if (binary === SDK.emulator && joinedArgs === '-list-avds') {
        return ok('Pixel_7')
      }
      return { stdout: '', stderr: 'device offline', code: 1 }
    })

    const devices = await listAndroidDevices(fake as unknown as AndroidCommandRunner, SDK)

    expect(devices[0]).toEqual(
      expect.objectContaining({ id: 'emulator-5554', state: 'unresponsive' })
    )
  })
})

describe('findRunningAvdSerial', () => {
  it('returns the serial whose AVD name matches', async () => {
    const fake = runner((binary, a) =>
      binary === SDK.adb && a === '-s emulator-5554 emu avd name' ? 'Pixel_7\nOK' : ''
    )
    const running = parseAdbDevices('List of devices attached\nemulator-5554\tdevice')
    expect(await findRunningAvdSerial(fake, SDK, 'Pixel_7', running)).toBe('emulator-5554')
    expect(await findRunningAvdSerial(fake, SDK, 'Other', running)).toBeNull()
  })
})
