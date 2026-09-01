import type { AndroidCommandRunner } from './android-command-runner'
import type { AndroidSdkPaths } from './android-sdk-discovery'
import { adbDevicesArgs, parseAdbDevices, type AndroidAdbDevice } from './adb-devices'
import { listAvdsArgs, parseAvdList } from './avd-manager'
import {
  ANDROID_DEVICE_PROBE_TIMEOUT_MS,
  probeAndroidDeviceHealth,
  type AndroidDeviceHealth
} from './android-device-health'
import type { EmulatorDevice } from '../backends/emulator-backend'

// Android device discovery: turns raw `adb`/`emulator` output into the
// cross-backend EmulatorDevice list and resolves AVD names to running serials.
// Kept separate from the backend so the inventory is testable in isolation and
// the backend file stays focused on lifecycle + input.

export async function listRunningAdbDevices(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths
): Promise<AndroidAdbDevice[]> {
  const result = await runner(sdk.adb, adbDevicesArgs)
  return parseAdbDevices(result.stdout).filter(
    (device) => device.state === 'device' || device.isEmulator
  )
}

export async function resolveRunningAvdNames(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  running: AndroidAdbDevice[],
  knownNamesBySerial: ReadonlyMap<string, string> = new Map()
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (const device of running) {
    const knownName = knownNamesBySerial.get(device.serial)
    if (knownName) {
      names.set(device.serial, knownName)
    }
  }
  await Promise.all(
    running
      .filter((device) => device.isEmulator)
      .map(async (device) => {
        const [consoleResult, propertyResult] = await Promise.all([
          runner(sdk.adb, ['-s', device.serial, 'emu', 'avd', 'name'], {
            timeoutMs: ANDROID_DEVICE_PROBE_TIMEOUT_MS
          }),
          runner(sdk.adb, ['-s', device.serial, 'shell', 'getprop', 'ro.boot.qemu.avd_name'], {
            timeoutMs: ANDROID_DEVICE_PROBE_TIMEOUT_MS
          })
        ])
        const name =
          (consoleResult.code === 0 ? firstNonStatusLine(consoleResult.stdout) : null) ??
          (propertyResult.code === 0 ? firstNonStatusLine(propertyResult.stdout) : null)
        if (name) {
          names.set(device.serial, name)
        }
      })
  )
  return names
}

export async function findRunningAvdSerial(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  avdName: string,
  running: AndroidAdbDevice[],
  knownNamesBySerial: ReadonlyMap<string, string> = new Map()
): Promise<string | null> {
  const names = await resolveRunningAvdNames(runner, sdk, running, knownNamesBySerial)
  for (const [serial, name] of names) {
    if (name === avdName) {
      return serial
    }
  }
  return null
}

export async function listAndroidDevices(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  knownNamesBySerial: ReadonlyMap<string, string> = new Map()
): Promise<EmulatorDevice[]> {
  const [running, avdsResult] = await Promise.all([
    listRunningAdbDevices(runner, sdk),
    runner(sdk.emulator, listAvdsArgs)
  ])
  const avds = parseAvdList(avdsResult.stdout)
  const [runningAvdBySerial, healthEntries] = await Promise.all([
    resolveRunningAvdNames(runner, sdk, running, knownNamesBySerial),
    Promise.all(
      running.map(
        async (device) =>
          [device.serial, await probeAndroidDeviceHealth(runner, sdk, device.serial)] as const
      )
    )
  ])
  return mergeAndroidDevices(running, avds, runningAvdBySerial, new Map(healthEntries))
}

// `adb -s <serial> emu avd name` prints the AVD name then a trailing "OK" line.
function firstNonStatusLine(stdout: string): string | null {
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line !== '' && line !== 'OK') {
      return line
    }
  }
  return null
}

export function mergeAndroidDevices(
  running: AndroidAdbDevice[],
  avds: string[],
  runningAvdBySerial: ReadonlyMap<string, string>,
  healthBySerial: ReadonlyMap<string, AndroidDeviceHealth> = new Map()
): EmulatorDevice[] {
  const devices: EmulatorDevice[] = []
  const runningAvdNames = new Set(runningAvdBySerial.values())

  for (const device of running) {
    const avdName = runningAvdBySerial.get(device.serial)
    const health = healthBySerial.get(device.serial) ?? 'booted'
    devices.push({
      backend: 'android',
      id: device.serial,
      name: avdName ?? device.model ?? device.serial,
      state: health,
      detail: device.isEmulator ? 'emulator' : 'device',
      isAvailable: true
    })
  }

  for (const avd of avds) {
    if (runningAvdNames.has(avd)) {
      continue
    }
    devices.push({
      backend: 'android',
      id: avd,
      name: avd,
      state: 'shutdown',
      detail: 'avd',
      isAvailable: true
    })
  }

  return devices
}
