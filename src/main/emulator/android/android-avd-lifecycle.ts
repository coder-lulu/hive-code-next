import { EmulatorError } from '../emulator-errors'
import type { EmulatorDevice } from '../backends/emulator-backend'
import { ensureAdbOk } from './android-adb-result'
import { bootAndroidDevice } from './android-avd-boot'
import type { AndroidCommandRunner } from './android-command-runner'
import { ANDROID_DEVICE_PROBE_TIMEOUT_MS } from './android-device-health'
import {
  findRunningAvdSerial,
  listAndroidDevices,
  listRunningAdbDevices
} from './android-device-inventory'
import {
  AndroidManagedAvdProcesses,
  type AndroidManagedAvdProcess
} from './android-managed-avd-processes'
import type { AndroidSdkPaths } from './android-sdk-discovery'
import { emuKillArgs } from './avd-manager'

export type AndroidAvdLifecycleOptions = {
  runner: AndroidCommandRunner
  sdk: () => AndroidSdkPaths
  bootTimeoutMs: number
  pollIntervalMs: number
  sleep: (ms: number) => Promise<void>
  managedAvds?: AndroidManagedAvdProcesses
}

/** Owns Android AVD discovery, identity, boot, recovery, and process cleanup. */
export class AndroidAvdLifecycle {
  private readonly runner: AndroidCommandRunner
  private readonly sdk: () => AndroidSdkPaths
  private readonly bootTimeoutMs: number
  private readonly pollIntervalMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly managedAvds: AndroidManagedAvdProcesses

  constructor(options: AndroidAvdLifecycleOptions) {
    this.runner = options.runner
    this.sdk = options.sdk
    this.bootTimeoutMs = options.bootTimeoutMs
    this.pollIntervalMs = options.pollIntervalMs
    this.sleep = options.sleep
    this.managedAvds = options.managedAvds ?? new AndroidManagedAvdProcesses()
  }

  listDevices(): Promise<EmulatorDevice[]> {
    return listAndroidDevices(this.runner, this.sdk(), this.managedAvds.namesBySerial())
  }

  async resolveDeviceId(deviceOrName: string): Promise<string> {
    const sdk = this.sdk()
    const running = await listRunningAdbDevices(this.runner, sdk)
    if (running.some((device) => device.serial === deviceOrName)) {
      return deviceOrName
    }
    const serial = await findRunningAvdSerial(
      this.runner,
      sdk,
      deviceOrName,
      running,
      this.managedAvds.namesBySerial()
    )
    if (serial) {
      return serial
    }
    throw new EmulatorError(
      'emulator_device_not_found',
      `Android device "${deviceOrName}" is not running. Boot it first.`
    )
  }

  ensureBooted(deviceOrName: string): Promise<string> {
    return bootAndroidDevice(this.runner, this.sdk(), deviceOrName, {
      bootTimeoutMs: this.bootTimeoutMs,
      pollIntervalMs: this.pollIntervalMs,
      sleep: this.sleep,
      managedAvds: this.managedAvds
    })
  }

  async shutdownDevice(deviceOrName: string): Promise<string> {
    const sdk = this.sdk()
    const serial = await this.resolveDeviceId(deviceOrName)
    const managed = this.findManagedProcess(serial, deviceOrName)
    const result = await this.runner(sdk.adb, emuKillArgs(serial), {
      timeoutMs: ANDROID_DEVICE_PROBE_TIMEOUT_MS
    })
    if (!managed) {
      ensureAdbOk(result, 'adb emulator shutdown')
      return serial
    }
    const terminated = await this.managedAvds.terminate(managed)
    if (result.code !== 0 && !terminated) {
      ensureAdbOk(result, 'adb emulator shutdown')
    }
    return serial
  }

  dispose(): Promise<void> {
    return this.managedAvds.dispose()
  }

  private findManagedProcess(
    serial: string,
    deviceOrName: string
  ): AndroidManagedAvdProcess | null {
    return this.managedAvds.findBySerial(serial) ?? this.managedAvds.findByName(deviceOrName)
  }
}
