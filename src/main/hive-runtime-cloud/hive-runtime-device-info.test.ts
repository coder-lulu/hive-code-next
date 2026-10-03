import { describe, expect, it, vi } from 'vitest'
import {
  collectHiveRuntimeDeviceInfo,
  collectHiveRuntimeFreeDiskBytes,
  createHiveRuntimeDeviceInfoSnapshot
} from './hive-runtime-device-info'

function source() {
  return {
    hostname: vi.fn(() => '  build-host  '),
    osName: vi.fn(() => 'Windows_NT'),
    osVersion: vi.fn(() => 'Windows 11 Enterprise'),
    osArch: vi.fn(() => 'x64'),
    cpus: vi.fn(() => [
      { model: '  Example CPU  ' },
      { model: '  Example CPU  ' },
      { model: '  Example CPU  ' },
      { model: '  Example CPU  ' }
    ]),
    totalMemoryBytes: vi.fn(() => 16 * 1024 ** 3)
  }
}

describe('Hive Runtime device information', () => {
  it('normalizes a cross-platform device snapshot without network addresses', () => {
    const info = collectHiveRuntimeDeviceInfo(source())

    expect(info).toEqual({
      deviceName: 'build-host',
      osName: 'Windows_NT',
      osVersion: 'Windows 11 Enterprise',
      osArch: 'x64',
      cpuModel: 'Example CPU',
      cpuLogicalCores: 4,
      totalMemoryBytes: 16 * 1024 ** 3
    })
    expect(info).not.toHaveProperty('ip')
    expect(Object.isFrozen(info)).toBe(true)
  })

  it('omits unavailable probes instead of failing the heartbeat', () => {
    const info = collectHiveRuntimeDeviceInfo({
      ...source(),
      hostname: () => {
        throw new Error('hostname unavailable')
      },
      osName: () => '',
      osArch: () => '  ',
      cpus: () => {
        throw new Error('cpu unavailable')
      },
      totalMemoryBytes: () => Number.NaN
    })

    expect(info).toEqual({ osVersion: 'Windows 11 Enterprise' })
  })

  it('bounds strings and omits an implausible logical core count', () => {
    const cpuInfo = [{ model: 'c'.repeat(300) }]
    cpuInfo.length = 65_537

    const info = collectHiveRuntimeDeviceInfo({
      hostname: () => 'd'.repeat(300),
      osName: () => 'n'.repeat(70),
      osVersion: () => 'v'.repeat(140),
      osArch: () => 'a'.repeat(40),
      cpus: () => cpuInfo,
      totalMemoryBytes: () => 8 * 1024 ** 3
    })

    expect(info.deviceName).toHaveLength(255)
    expect(info.osName).toHaveLength(64)
    expect(info.osVersion).toHaveLength(128)
    expect(info.osArch).toHaveLength(32)
    expect(info.cpuModel).toHaveLength(255)
    expect(info).not.toHaveProperty('cpuLogicalCores')
  })

  it('collects the stable fields once for all heartbeat reports', () => {
    const deviceSource = source()
    const getSnapshot = createHiveRuntimeDeviceInfoSnapshot(deviceSource)

    const first = getSnapshot()
    const second = getSnapshot()

    expect(second).toBe(first)
    for (const probe of Object.values(deviceSource)) {
      expect(probe).toHaveBeenCalledOnce()
    }
  })

  it('reports current free disk bytes without caching a dynamic metric', () => {
    expect(
      collectHiveRuntimeFreeDiskBytes('runtime-data', (path) => {
        expect(path).toBe('runtime-data')
        return { availableBlocks: 128n, blockSize: 4096n }
      })
    ).toBe(512 * 1024)
    expect(
      collectHiveRuntimeFreeDiskBytes('runtime-data', () => ({
        availableBlocks: 0n,
        blockSize: 4096n
      }))
    ).toBe(0)
  })

  it('omits unavailable or unsafe free disk measurements', () => {
    expect(
      collectHiveRuntimeFreeDiskBytes('runtime-data', () => {
        throw new Error('filesystem unavailable')
      })
    ).toBeUndefined()
    expect(
      collectHiveRuntimeFreeDiskBytes('runtime-data', () => ({
        availableBlocks: BigInt(Number.MAX_SAFE_INTEGER),
        blockSize: 2n
      }))
    ).toBeUndefined()
  })
})
