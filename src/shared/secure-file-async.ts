import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { restrictWindowsPathAsync } from './secure-path-windows-acl'
import { recordHardeningOutcome } from './secure-path-hardening-retry-budget'
import { writeSecureJsonFile, rememberHardenedPath } from './secure-file'

/** Publishes only after staged ACL hardening settles, without blocking on Windows subprocesses. */
export async function writeSecureJsonFileAsync(
  targetPath: string,
  value: unknown
): Promise<boolean> {
  if (process.platform !== 'win32') {
    return writeSecureJsonFile(targetPath, value)
  }
  const dir = dirname(targetPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  await restrictWindowsPathAsync(dir, true)
  const tmpFile = `${targetPath}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
  try {
    writeFileSync(tmpFile, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 })
    const stagedRestricted = await restrictWindowsPathAsync(tmpFile, false)
    renameSync(tmpFile, targetPath)
    const publishedRestricted = await restrictWindowsPathAsync(targetPath, false)
    if (publishedRestricted) {
      rememberHardenedPath(targetPath, false)
      recordHardeningOutcome(targetPath, true)
    }
    return stagedRestricted && publishedRestricted
  } catch (error) {
    rmSync(tmpFile, { force: true })
    throw error
  }
}
