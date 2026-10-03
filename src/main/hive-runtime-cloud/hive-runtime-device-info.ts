import { statfsSync } from 'node:fs'
import { arch, cpus, hostname, totalmem, type, version } from 'node:os'

const MAX_DEVICE_NAME_LENGTH = 255
const MAX_OS_NAME_LENGTH = 64
const MAX_OS_VERSION_LENGTH = 128
const MAX_OS_ARCH_LENGTH = 32
const MAX_CPU_MODEL_LENGTH = 255
const MAX_CPU_LOGICAL_CORES = 65_536

export type HiveRuntimeDeviceInfo = Readonly<{
  deviceName?: string
  osName?: string
  osVersion?: string
  osArch?: string
  cpuModel?: string
  cpuLogicalCores?: number
  totalMemoryBytes?: number
  freeDiskBytes?: number
}>

type RuntimeDeviceInfoSource = Readonly<{
  hostname: () => string
  osName: () => string
  osVersion: () => string
  osArch: () => string
  cpus: () => readonly Readonly<{ model: string }>[]
  totalMemoryBytes: () => number
}>

const nodeRuntimeDeviceInfoSource: RuntimeDeviceInfoSource = {
  hostname,
  osName: type,
  osVersion: version,
  osArch: arch,
  cpus,
  totalMemoryBytes: totalmem
}

type RuntimeDiskInfoSource = (
  path: string
) => Readonly<{ availableBlocks: bigint; blockSize: bigint }>

const nodeRuntimeDiskInfoSource: RuntimeDiskInfoSource = (path) => {
  const stats = statfsSync(path, { bigint: true })
  return { availableBlocks: stats.bavail, blockSize: stats.bsize }
}

function readText(read: () => string, maxLength: number): string | undefined {
  try {
    const value = read().trim()
    return value ? value.slice(0, maxLength) : undefined
  } catch {
    return undefined
  }
}

function readPositiveInteger(read: () => number): number | undefined {
  try {
    const value = read()
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export function collectHiveRuntimeDeviceInfo(
  source: RuntimeDeviceInfoSource = nodeRuntimeDeviceInfoSource
): HiveRuntimeDeviceInfo {
  let cpuInfo: readonly Readonly<{ model: string }>[] = []
  try {
    cpuInfo = source.cpus()
  } catch {
    // A platform probe failure must not prevent the Runtime heartbeat.
  }
  const deviceName = readText(source.hostname, MAX_DEVICE_NAME_LENGTH)
  const osName = readText(source.osName, MAX_OS_NAME_LENGTH)
  const osVersion = readText(source.osVersion, MAX_OS_VERSION_LENGTH)
  const osArch = readText(source.osArch, MAX_OS_ARCH_LENGTH)
  const cpuModel = readText(
    () => cpuInfo.find((cpu) => cpu.model.trim())?.model ?? '',
    MAX_CPU_MODEL_LENGTH
  )
  const cpuLogicalCores =
    cpuInfo.length > 0 && cpuInfo.length <= MAX_CPU_LOGICAL_CORES ? cpuInfo.length : undefined
  const totalMemoryBytes = readPositiveInteger(source.totalMemoryBytes)
  return Object.freeze({
    ...(deviceName ? { deviceName } : {}),
    ...(osName ? { osName } : {}),
    ...(osVersion ? { osVersion } : {}),
    ...(osArch ? { osArch } : {}),
    ...(cpuModel ? { cpuModel } : {}),
    ...(cpuLogicalCores !== undefined ? { cpuLogicalCores } : {}),
    ...(totalMemoryBytes !== undefined ? { totalMemoryBytes } : {})
  })
}

export function collectHiveRuntimeFreeDiskBytes(
  path: string,
  source: RuntimeDiskInfoSource = nodeRuntimeDiskInfoSource
): number | undefined {
  try {
    const { availableBlocks, blockSize } = source(path)
    const bytes = availableBlocks * blockSize
    return bytes >= 0n && bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : undefined
  } catch {
    return undefined
  }
}

export function createHiveRuntimeDeviceInfoSnapshot(
  source: RuntimeDeviceInfoSource = nodeRuntimeDeviceInfoSource
): () => HiveRuntimeDeviceInfo {
  let snapshot: HiveRuntimeDeviceInfo | undefined
  return () => (snapshot ??= collectHiveRuntimeDeviceInfo(source))
}

export const getHiveRuntimeDeviceInfoSnapshot = createHiveRuntimeDeviceInfoSnapshot()
