import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export async function codexPackageDigest(path, maximumBytes) {
  const digest = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.byteLength
    if (bytes > maximumBytes) {
      throw new Error('CODEX_PACKAGE_CAPACITY_EXCEEDED')
    }
    digest.update(chunk)
  }
  return { sha256: digest.digest('hex'), bytes }
}

/** Reuse only a digest-verified asset; credentials are never sent to the download endpoint. */
export async function obtainCodexPackage(pin, path, fetchPackage = fetch) {
  const source = new URL(pin.asset)
  if (
    source.protocol !== 'https:' ||
    source.hostname !== 'github.com' ||
    !/^\/openai\/codex\/releases\/download\/rust-v[0-9.]+\/codex-package-x86_64-unknown-linux-musl\.tar\.gz$/.test(
      source.pathname
    ) ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    !/^[a-f0-9]{64}$/.test(pin.sha256) ||
    !Number.isSafeInteger(pin.maximumBytes) ||
    pin.maximumBytes <= 0 ||
    pin.maximumBytes > 256 * 1024 * 1024
  ) {
    throw new Error('CODEX_PACKAGE_PIN_INVALID')
  }
  try {
    const cached = await codexPackageDigest(path, pin.maximumBytes)
    if (cached.sha256 !== pin.sha256) {
      throw new Error('CODEX_PACKAGE_DIGEST_MISMATCH')
    }
    return { ...cached, reused: true }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `${basename(path)}.${randomUUID()}.download`)
  const handle = await open(temporary, 'wx', 0o600)
  let closed = false
  try {
    const response = await fetchPackage(source.href, {
      redirect: 'follow',
      signal: AbortSignal.timeout(180_000),
      credentials: 'omit'
    })
    const effective = new URL(response.url || source.href)
    if (
      !response.ok ||
      !response.body ||
      effective.protocol !== 'https:' ||
      ![
        'github.com',
        'release-assets.githubusercontent.com',
        'objects.githubusercontent.com'
      ].includes(effective.hostname)
    ) {
      throw new Error('CODEX_PACKAGE_DOWNLOAD_UNAVAILABLE')
    }
    const digest = createHash('sha256')
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > pin.maximumBytes) {
        throw new Error('CODEX_PACKAGE_CAPACITY_EXCEEDED')
      }
      digest.update(chunk)
      await handle.writeFile(chunk)
    }
    const sha256 = digest.digest('hex')
    if (sha256 !== pin.sha256) {
      throw new Error('CODEX_PACKAGE_DIGEST_MISMATCH')
    }
    await handle.sync()
    await handle.close()
    closed = true
    await rename(temporary, path)
    return { sha256, bytes, reused: false }
  } finally {
    if (!closed) {
      await handle.close()
    }
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error
      }
    })
  }
}
