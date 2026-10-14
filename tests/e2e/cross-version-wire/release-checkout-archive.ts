import { createHash } from 'node:crypto'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { list as listTar } from 'tar'

function checkoutTarProgram(): string {
  if (process.platform !== 'win32') {
    return 'tar'
  }
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
  return join(systemRoot, 'System32', 'tar.exe')
}

async function extractWindowsCheckout(
  staging: string,
  archive: string,
  workers: number,
  excludes: string[],
  run: (program: string, args: string[]) => Promise<string>
): Promise<void> {
  const paths: string[][] = Array.from({ length: workers }, () => [])
  await listTar({
    file: archive,
    strict: true,
    onReadEntry: (entry) => {
      if (['File', 'SymbolicLink', 'Link'].includes(entry.type)) {
        const bucket = createHash('sha1').update(entry.path).digest()[0] % paths.length
        paths[bucket].push(entry.path)
      }
    }
  })
  const manifests = paths.map((_, index) => join(staging, `.checkout-paths-${index}.txt`))
  try {
    const writes = await Promise.allSettled(
      paths.map((part, index) => writeFile(manifests[index], part.join('\n')))
    )
    for (const result of writes) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
    // Windows metadata writes dominate a serial extraction; each member has one owner.
    const results = await Promise.allSettled(
      paths.map((part, index) =>
        part.length === 0
          ? Promise.resolve()
          : run(checkoutTarProgram(), [
              ...excludes,
              '-xf',
              archive,
              '-C',
              staging,
              '-T',
              manifests[index]
            ])
      )
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
  } finally {
    await Promise.all(manifests.map((manifest) => rm(manifest, { force: true })))
  }
}

export async function extractReleaseArchive(
  staging: string,
  archive: string,
  platform: NodeJS.Platform,
  excludes: string[],
  workers: number,
  run: (program: string, args: string[]) => Promise<string>
): Promise<void> {
  await (platform === 'win32'
    ? extractWindowsCheckout(staging, archive, workers, excludes, run)
    : run(checkoutTarProgram(), [...excludes, '-xf', archive, '-C', staging]))
}
