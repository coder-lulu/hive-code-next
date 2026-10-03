import { createHash } from 'node:crypto'
import { constants, lstatSync, realpathSync, type BigIntStats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join } from 'node:path'

function identity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(
    ':'
  )
}

function assertRegularFile(stat: BigIntStats): void {
  if (!stat.isFile() || stat.nlink !== 1n) {
    throw new Error('invalid Pack file')
  }
}

/** Hash once; the retained guard detects observable changes without blocking on binary reads. */
export async function verifyManagedPiPackFile(
  root: string,
  filename: string,
  maximumBytes: number,
  expected?: { size: number; sha256: string }
): Promise<{ sha256: string; content: string | undefined; assertCurrent: () => void }> {
  const path = join(root, filename)
  const before = await lstat(path, { bigint: true })
  assertRegularFile(before)
  if (
    before.size <= 0n ||
    before.size > BigInt(maximumBytes) ||
    (expected && before.size !== BigInt(expected.size)) ||
    (await realpath(path)) !== path
  ) {
    throw new Error('invalid Pack file')
  }
  const fingerprint = identity(before)
  const flags =
    constants.O_RDONLY |
    (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const handle = await open(path, flags)
  const assertCurrent = () => {
    const current = lstatSync(path, { bigint: true })
    assertRegularFile(current)
    if (identity(current) !== fingerprint || realpathSync.native(path) !== path) {
      throw new Error('stale Pack file')
    }
  }
  try {
    if (identity(await handle.stat({ bigint: true })) !== fingerprint) {
      throw new Error('replaced Pack file')
    }
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(64 * 1024)
    const content: Buffer[] = []
    let offset = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
      if (offset > maximumBytes || BigInt(offset) > before.size) {
        throw new Error('Pack file grew')
      }
      const chunk = buffer.subarray(0, bytesRead)
      hash.update(chunk)
      if (!expected) {
        content.push(Buffer.from(chunk))
      }
    }
    if (
      BigInt(offset) !== before.size ||
      identity(await handle.stat({ bigint: true })) !== fingerprint
    ) {
      throw new Error('Pack file changed during verification')
    }
    assertCurrent()
    const sha256 = hash.digest('hex')
    if (expected && sha256 !== expected.sha256) {
      throw new Error('Pack file digest mismatch')
    }
    return {
      sha256,
      content: expected ? undefined : Buffer.concat(content).toString('utf8'),
      assertCurrent
    }
  } finally {
    await handle.close()
  }
}

export async function verifyManagedPiPackRoot(path: string) {
  const stat = await lstat(path, { bigint: true })
  if (!stat.isDirectory()) {
    throw new Error('invalid Pack root')
  }
  const root = await realpath(path)
  const fingerprint = identity(stat)
  return {
    root,
    assertCurrent: () => {
      const current = lstatSync(path, { bigint: true })
      if (
        !current.isDirectory() ||
        identity(current) !== fingerprint ||
        realpathSync.native(path) !== root
      ) {
        throw new Error('stale Pack root')
      }
    }
  }
}
