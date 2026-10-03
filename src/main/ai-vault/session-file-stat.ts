import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isWslUncPath } from '../../shared/wsl-paths'
import { wslGatedStat } from '../native-chat/wsl-transcript-fs-access'
import type { FileWithMtime } from './session-scanner-types'

type SessionFileStat = Pick<Stats, 'dev' | 'ino' | 'nlink' | 'size' | 'mtimeMs'> &
  Pick<FileWithMtime, 'filesystemIdentity'>

/** Keep exact identity at discovery; Number cannot represent every NTFS inode. */
export async function statSessionFile(path: string): Promise<SessionFileStat> {
  if (isWslUncPath(path)) {
    const fileStat = await wslGatedStat(path, 'scan')
    if (typeof fileStat.dev === 'number' && typeof fileStat.ino === 'number') {
      if (!Number.isSafeInteger(fileStat.dev) || !Number.isSafeInteger(fileStat.ino)) {
        throw new Error('Transcript filesystem identity was not represented exactly')
      }
      return {
        ...fileStat,
        filesystemIdentity: { dev: String(fileStat.dev), ino: String(fileStat.ino) }
      }
    }
    return fileStat
  }
  // One stat, at the existing acquisition; no extra probe on an index read/write.
  const fileStat = await stat(path, { bigint: true })
  return {
    dev: Number(fileStat.dev),
    ino: Number(fileStat.ino),
    nlink: Number(fileStat.nlink),
    size: Number(fileStat.size),
    mtimeMs:
      Number(fileStat.mtimeNs / 1_000_000_000n) * 1_000 +
      Number(fileStat.mtimeNs % 1_000_000_000n) / 1_000_000,
    filesystemIdentity: { dev: String(fileStat.dev), ino: String(fileStat.ino) }
  }
}
