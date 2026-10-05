import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  __setWindowsProcessTreeLoaderForTests,
  __setWindowsProcessTreeRequireForTests,
  requestWindowsProcessTermination
} from './windows-process-table'

const admission = vi.hoisted(() => vi.fn(() => true))
vi.mock('../own-chromium-tree-kill-guard', () => ({ admitSelfInitiatedTreeKill: admission }))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')
const terminate = vi.fn<(pid: number, birth: number) => boolean>()
const scan = vi.fn()
const target = 1234
const birth = 1_700_000_000_000

beforeEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  admission.mockReset().mockReturnValue(true)
  terminate.mockReset().mockReturnValue(true)
  scan.mockReset()
  __setWindowsProcessTreeLoaderForTests(() => ({
    ProcessDataFlag: { None: 0, CommandLine: 2, CreationTime: 4 },
    getAllProcesses: scan,
    terminateProcessIfCreationTimeMatches: terminate
  }))
})

afterEach(() => {
  __setWindowsProcessTreeRequireForTests()
  if (platform) {
    Object.defineProperty(process, 'platform', platform)
  }
})

it('requests native termination with the exact retained birth and truthful admission scope', () => {
  expect(requestWindowsProcessTermination(target, birth)).toBe('requested')
  expect(terminate).toHaveBeenCalledExactlyOnceWith(target, birth)
  expect(admission).toHaveBeenCalledExactlyOnceWith({
    pid: target,
    site: 'windows-identified-process',
    scope: 'win-identified-process'
  })
  expect(scan).not.toHaveBeenCalled()
})

it.each([0, -1, Number.NaN, Infinity, 1.5, 0x100000000, process.pid])(
  'refuses invalid or self PID %s without admission or native access',
  (pid) => {
    expect(requestWindowsProcessTermination(pid, birth)).toBe('unavailable')
    expect(terminate).not.toHaveBeenCalled()
    expect(admission).not.toHaveBeenCalled()
  }
)

it.each([0, -1, Number.NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'refuses invalid birth %s without admission or native access',
  (invalidBirth) => {
    expect(requestWindowsProcessTermination(target, invalidBirth)).toBe('unavailable')
    expect(terminate).not.toHaveBeenCalled()
    expect(admission).not.toHaveBeenCalled()
  }
)

it('preserves own-Chromium refusal before the native request', () => {
  admission.mockReturnValue(false)
  expect(requestWindowsProcessTermination(target, birth)).toBe('unavailable')
  expect(terminate).not.toHaveBeenCalled()
})

it('refuses a native birth mismatch or access denial without pretending exit', () => {
  terminate.mockReturnValue(false)
  expect(requestWindowsProcessTermination(target, birth)).toBe('unavailable')
})

it('keeps native errors unavailable', () => {
  terminate.mockImplementation(() => {
    throw new Error('access denied')
  })
  expect(requestWindowsProcessTermination(target, birth)).toBe('unavailable')
})

it.each([true, false])(
  'does not fall back when the native export is stale or absent: %s',
  (loaded) => {
    __setWindowsProcessTreeLoaderForTests(() =>
      loaded
        ? {
            ProcessDataFlag: { None: 0, CommandLine: 2, CreationTime: 4 },
            getAllProcesses: scan
          }
        : null
    )
    expect(requestWindowsProcessTermination(target, birth)).toBe('unavailable')
    expect(scan).not.toHaveBeenCalled()
    expect(terminate).not.toHaveBeenCalled()
  }
)

it('does not access the native addon off Windows', () => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
  expect(requestWindowsProcessTermination(target, birth)).toBe('unavailable')
  expect(terminate).not.toHaveBeenCalled()
})

it('uses the same feature-detected operation from the staged relay addon', () => {
  __setWindowsProcessTreeRequireForTests((specifier) => {
    if (specifier === '@vscode/windows-process-tree') {
      throw new Error('no package')
    }
    return { getProcessList: scan, terminateProcessIfCreationTimeMatches: terminate }
  })
  expect(requestWindowsProcessTermination(target, birth)).toBe('requested')
  expect(terminate).toHaveBeenCalledExactlyOnceWith(target, birth)
})
