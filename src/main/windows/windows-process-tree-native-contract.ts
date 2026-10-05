export type NativeProcessInfo = {
  pid: number
  ppid: number
  name: string
  commandLine?: string
  creationTimeMs?: number
}

type NativeIdentityOperations = {
  /** Actual compiled capability; a patched JS wrapper can still load a stale binary. */
  supportedProcessDataFlags?: number
  getProcessCreationTime?: (pid: number) => number | undefined
  /** True means requested, never observed exit. */
  terminateProcessIfCreationTimeMatches?: (pid: number, birth: number) => boolean
}

export type WindowsProcessTreeModule = NativeIdentityOperations & {
  ProcessDataFlag: { None: number; CommandLine: number; CreationTime?: number }
  getAllProcesses: (
    callback: (processes: NativeProcessInfo[] | undefined) => void,
    flags?: number
  ) => void
}

/** Bare relay addon; the table facade owns the same mutual-exclusion gate as the package queue. */
export type WindowsProcessTreeAddon = NativeIdentityOperations & {
  getProcessList: (
    callback: (processes: NativeProcessInfo[] | undefined) => void,
    flags: number
  ) => void
}
