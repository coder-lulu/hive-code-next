import { EmulatorError } from '../emulator-errors'
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
  externalAndroidEmulatorUnresponsiveError
} from './android-avd-boot-errors'

export type AndroidBootOptions = {
  bootTimeoutMs: number
  pollIntervalMs: number
  sleep: (ms: number) => Promise<void>
  managedAvds: AndroidManagedAvdProcesses
}

type BootBudget = {
  remainingMs: number
  usedColdRestart: boolean
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
  const budget: BootBudget = {
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
  const serial = direct?.serial ?? namedSerial

  if (serial) {
    const managed =
      options.managedAvds.findBySerial(serial) ?? options.managedAvds.findByName(deviceOrName)
    if (managed && !managed.serial) {
      options.managedAvds.bindSerial(managed, serial)
    }
    return ensureRunningDeviceHealthy(
      runner,
      sdk,
      serial,
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
    const health = await probeAndroidDeviceHealth(runner, sdk, device.serial)
    if (health === 'unresponsive') {
      throw externalAndroidEmulatorUnresponsiveError(device.serial, deviceOrName, true)
    }
    throw new EmulatorError(
      'emulator_helper_failed',
      `Android emulator ${device.serial} is ${health}, but HiveCode cannot determine whether it is AVD "${deviceOrName}". Wait for it to finish starting or select it by serial; HiveCode will not start a possible duplicate.`
    )
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
  serial: string,
  name: string,
  managed: AndroidManagedAvdProcess | null,
  options: AndroidBootOptions,
  budget: BootBudget
): Promise<string> {
  const health = await probeAndroidDeviceHealth(runner, sdk, serial)
  if (health === 'booted') {
    return serial
  }
  if (health === 'unresponsive') {
    if (!managed) {
      throw externalAndroidEmulatorUnresponsiveError(serial, name, false)
    }
    return restartManagedAvd(runner, sdk, managed, options, budget)
  }
  return waitForSerialBoot(runner, sdk, serial, name, managed, options, budget)
}

async function waitForSerialBoot(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  serial: string,
  name: string,
  managed: AndroidManagedAvdProcess | null,
  options: AndroidBootOptions,
  budget: BootBudget
): Promise<string> {
  while (budget.remainingMs > 0) {
    if (managed?.exitResult) {
      throw androidAvdLaunchExitedError(managed)
    }
    const running = await listRunningAdbDevices(runner, sdk)
    if (managed?.exitResult) {
      throw androidAvdLaunchExitedError(managed)
    }
    if (!running.some((device) => device.serial === serial)) {
      await waitForNextPoll(options, budget, managed)
      continue
    }
    const health = await probeAndroidDeviceHealth(runner, sdk, serial)
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
    await stopTimedOutManagedAvd(managed, options)
  }
  throw androidAvdBootTimedOutError(name)
}

async function waitForManagedBoot(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  process: AndroidManagedAvdProcess,
  knownSerials: Set<string>,
  options: AndroidBootOptions,
  budget: BootBudget
): Promise<string> {
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

    for (const device of candidates) {
      if (!process.serial) {
        options.managedAvds.bindSerial(process, device.serial)
      }
      const health = await probeAndroidDeviceHealth(runner, sdk, device.serial)
      if (health === 'booted') {
        return device.serial
      }
      if (health === 'unresponsive') {
        return restartManagedAvd(runner, sdk, process, options, budget)
      }
    }
    await waitForNextPoll(options, budget, process)
  }

  await stopTimedOutManagedAvd(process, options)
  throw androidAvdBootTimedOutError(process.avdName)
}

async function restartManagedAvd(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  process: AndroidManagedAvdProcess,
  options: AndroidBootOptions,
  budget: BootBudget
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
  budget: BootBudget
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

async function waitForNextPoll(
  options: AndroidBootOptions,
  budget: BootBudget,
  process: AndroidManagedAvdProcess | null
): Promise<void> {
  const waitMs = Math.min(options.pollIntervalMs, budget.remainingMs)
  if (waitMs <= 0) {
    return
  }
  budget.remainingMs -= waitMs
  if (!process) {
    await options.sleep(waitMs)
    return
  }
  await Promise.race([options.sleep(waitMs), process.exit.then(() => undefined)])
  if (process.exitResult) {
    throw androidAvdLaunchExitedError(process)
  }
}

function launchManagedAvd(
  managedAvds: AndroidManagedAvdProcesses,
  emulatorPath: string,
  avdName: string,
  coldBoot: boolean
): AndroidManagedAvdProcess {
  try {
    return managedAvds.launch(emulatorPath, avdName, { coldBoot })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new EmulatorError(
      'emulator_helper_failed',
      `Could not launch AVD "${avdName}": ${message}`
    )
  }
}

async function stopTimedOutManagedAvd(
  process: AndroidManagedAvdProcess,
  options: AndroidBootOptions
): Promise<void> {
  if (!(await options.managedAvds.terminate(process))) {
    throw new EmulatorError(
      'emulator_helper_failed',
      `AVD "${process.avdName}" timed out and HiveCode could not stop its process safely.`
    )
  }
}
