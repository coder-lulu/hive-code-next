import { EmulatorError } from '../emulator-errors'
import type { AndroidAdbDevice, AndroidAdbDeviceState } from './adb-devices'
import type { AndroidCommandRunner } from './android-command-runner'
import type { AndroidSdkPaths } from './android-sdk-discovery'
import { listAvdsArgs, parseAvdList } from './avd-manager'
import { listRunningAdbDevices, resolveRunningAvdNames } from './android-device-inventory'
import { probeAndroidDeviceHealth } from './android-device-health'
import type {
  AndroidManagedAvdProcess,
  AndroidManagedAvdProcesses
} from './android-managed-avd-processes'
import {
  androidAvdBootTimedOutError,
  androidAvdLaunchExitedError,
  androidAvdStayedOfflineError,
  externalAndroidEmulatorUnresponsiveError,
  unidentifiedExternalEmulatorError
} from './android-avd-boot-errors'
import {
  launchManagedAvd,
  probeDeviceHealthDuringBoot,
  stopTimedOutManagedAvd,
  waitForNextPoll,
  waitForUnidentifiedExternalEmulatorTransition,
  type AndroidBootBudget
} from './android-avd-boot-support'

export type AndroidBootOptions = {
  bootTimeoutMs: number
  pollIntervalMs: number
  sleep: (ms: number) => Promise<void>
  managedAvds: AndroidManagedAvdProcesses
}

// Returns a healthy adb serial. AVDs launched by HiveCode get one automatic
// cold restart when their adb transport stops responding; external processes
// are never killed.
export async function bootAndroidDevice(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  deviceOrName: string,
  options: AndroidBootOptions
): Promise<string> {
  const budget: AndroidBootBudget = {
    remainingMs: options.bootTimeoutMs,
    usedColdRestart: false
  }
  const running = await listRunningAdbDevices(runner, sdk)
  const namesBySerial = await resolveRunningAvdNames(
    runner,
    sdk,
    running,
    options.managedAvds.namesBySerial()
  )
  const direct = running.find((device) => device.serial === deviceOrName)
  const namedSerial = [...namesBySerial].find(([, name]) => name === deviceOrName)?.[0]
  const selectedDevice = direct ?? running.find((device) => device.serial === namedSerial)

  if (selectedDevice) {
    const serial = selectedDevice.serial
    const managed =
      options.managedAvds.findBySerial(serial) ?? options.managedAvds.findByName(deviceOrName)
    if (managed && !managed.serial) {
      options.managedAvds.bindSerial(managed, serial)
    }
    return ensureRunningDeviceHealthy(
      runner,
      sdk,
      selectedDevice,
      namesBySerial.get(serial) ?? deviceOrName,
      managed,
      options,
      budget
    )
  }

  const inFlight = options.managedAvds.findByName(deviceOrName)
  if (inFlight) {
    return waitForManagedBoot(
      runner,
      sdk,
      inFlight,
      new Set(running.map((device) => device.serial)),
      options,
      budget
    )
  }

  const avds = parseAvdList((await runner(sdk.emulator, listAvdsArgs)).stdout)
  if (!avds.includes(deviceOrName)) {
    throw new EmulatorError(
      'emulator_device_not_found',
      `"${deviceOrName}" is not a running device or a known AVD.`
    )
  }

  // Do not risk starting a second copy when adb can see an emulator but cannot
  // identify it. HiveCode has no ownership proof for such a process.
  for (const device of running.filter(
    (candidate) => candidate.isEmulator && !namesBySerial.has(candidate.serial)
  )) {
    const candidate =
      device.state === 'offline'
        ? await waitForUnidentifiedExternalEmulatorTransition(
            runner,
            sdk,
            device,
            deviceOrName,
            options,
            budget
          )
        : device
    if (candidate !== device) {
      const refreshedNames = await resolveRunningAvdNames(
        runner,
        sdk,
        [candidate],
        options.managedAvds.namesBySerial()
      )
      if (refreshedNames.get(candidate.serial) === deviceOrName) {
        return ensureRunningDeviceHealthy(
          runner,
          sdk,
          candidate,
          deviceOrName,
          null,
          options,
          budget
        )
      }
    }
    const health = await probeAndroidDeviceHealth(runner, sdk, candidate.serial)
    if (health === 'unresponsive') {
      throw externalAndroidEmulatorUnresponsiveError(candidate.serial, deviceOrName, true)
    }
    throw unidentifiedExternalEmulatorError(candidate.serial, deviceOrName, health)
  }

  const process = launchManagedAvd(options.managedAvds, sdk.emulator, deviceOrName, false)
  return waitForManagedBoot(
    runner,
    sdk,
    process,
    new Set(running.map((device) => device.serial)),
    options,
    budget
  )
}

async function ensureRunningDeviceHealthy(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  device: AndroidAdbDevice,
  name: string,
  managed: AndroidManagedAvdProcess | null,
  options: AndroidBootOptions,
  budget: AndroidBootBudget
): Promise<string> {
  const health = await probeDeviceHealthDuringBoot(runner, sdk, device)
  if (health === 'booted') {
    return device.serial
  }
  if (health === 'unresponsive') {
    if (!managed) {
      throw externalAndroidEmulatorUnresponsiveError(device.serial, name, false)
    }
    return restartManagedAvd(runner, sdk, managed, options, budget)
  }
  return waitForSerialBoot(runner, sdk, device.serial, device.state, name, managed, options, budget)
}

async function waitForSerialBoot(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  serial: string,
  initialState: AndroidAdbDeviceState,
  name: string,
  managed: AndroidManagedAvdProcess | null,
  options: AndroidBootOptions,
  budget: AndroidBootBudget
): Promise<string> {
  let lastObservedState: AndroidAdbDeviceState | null = initialState
  while (budget.remainingMs > 0) {
    if (managed?.exitResult) {
      throw androidAvdLaunchExitedError(managed)
    }
    const running = await listRunningAdbDevices(runner, sdk)
    if (managed?.exitResult) {
      throw androidAvdLaunchExitedError(managed)
    }
    const device = running.find((candidate) => candidate.serial === serial)
    if (!device) {
      lastObservedState = null
      await waitForNextPoll(options, budget, managed)
      continue
    }
    lastObservedState = device.state
    const health = await probeDeviceHealthDuringBoot(runner, sdk, device)
    if (health === 'booted') {
      return serial
    }
    if (health === 'unresponsive') {
      if (!managed) {
        throw externalAndroidEmulatorUnresponsiveError(serial, name, false)
      }
      return restartManagedAvd(runner, sdk, managed, options, budget)
    }
    await waitForNextPoll(options, budget, managed)
  }
  if (managed) {
    await stopTimedOutManagedAvd(managed, options.managedAvds)
  }
  if (lastObservedState === 'offline') {
    if (!managed) {
      throw externalAndroidEmulatorUnresponsiveError(serial, name, false)
    }
    throw androidAvdStayedOfflineError(name, serial)
  }
  throw androidAvdBootTimedOutError(name)
}

async function waitForManagedBoot(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  process: AndroidManagedAvdProcess,
  knownSerials: Set<string>,
  options: AndroidBootOptions,
  budget: AndroidBootBudget
): Promise<string> {
  let lastObservedState: AndroidAdbDeviceState | null = null
  while (budget.remainingMs > 0) {
    if (process.exitResult) {
      throw androidAvdLaunchExitedError(process)
    }
    const running = await listRunningAdbDevices(runner, sdk)
    if (process.exitResult) {
      throw androidAvdLaunchExitedError(process)
    }
    const candidates = process.serial
      ? running.filter((device) => device.serial === process.serial)
      : running.filter((device) => device.isEmulator && !knownSerials.has(device.serial))

    if (candidates.length === 0) {
      lastObservedState = null
    }
    for (const device of candidates) {
      if (!process.serial) {
        options.managedAvds.bindSerial(process, device.serial)
      }
      lastObservedState = device.state
      const health = await probeDeviceHealthDuringBoot(runner, sdk, device)
      if (health === 'booted') {
        return device.serial
      }
      if (health === 'unresponsive') {
        return restartManagedAvd(runner, sdk, process, options, budget)
      }
    }
    await waitForNextPoll(options, budget, process)
  }

  await stopTimedOutManagedAvd(process, options.managedAvds)
  if (lastObservedState === 'offline') {
    throw androidAvdStayedOfflineError(process.avdName, process.serial)
  }
  throw androidAvdBootTimedOutError(process.avdName)
}

async function restartManagedAvd(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  process: AndroidManagedAvdProcess,
  options: AndroidBootOptions,
  budget: AndroidBootBudget
): Promise<string> {
  if (budget.usedColdRestart) {
    await options.managedAvds.terminate(process)
    throw new EmulatorError(
      'emulator_device_unresponsive',
      `AVD "${process.avdName}" stayed unresponsive after HiveCode restarted it once. Open Android Studio Device Manager, cold boot or wipe the AVD, then try again.`
    )
  }
  budget.usedColdRestart = true

  const staleSerial = process.serial
  if (!(await options.managedAvds.terminate(process))) {
    throw new EmulatorError(
      'emulator_helper_failed',
      `HiveCode could not stop its unresponsive AVD "${process.avdName}" safely.`
    )
  }

  const knownSerials = await waitForStoppedSerial(runner, sdk, staleSerial, options, budget)
  const restarted = launchManagedAvd(options.managedAvds, sdk.emulator, process.avdName, true)
  return waitForManagedBoot(runner, sdk, restarted, knownSerials, options, budget)
}

async function waitForStoppedSerial(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  staleSerial: string | null,
  options: AndroidBootOptions,
  budget: AndroidBootBudget
): Promise<Set<string>> {
  while (budget.remainingMs > 0) {
    const running = await listRunningAdbDevices(runner, sdk)
    if (!staleSerial || !running.some((device) => device.serial === staleSerial)) {
      return new Set(running.map((device) => device.serial))
    }
    await waitForNextPoll(options, budget, null)
  }
  throw new EmulatorError(
    'emulator_helper_failed',
    `The unresponsive emulator ${staleSerial ?? ''} did not stop in time.`.trim()
  )
}
