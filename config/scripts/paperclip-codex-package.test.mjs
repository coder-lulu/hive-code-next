import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { obtainCodexPackage } from './paperclip-codex-package.mjs'

const contents = new TextEncoder().encode('controlled package fixture')
const pin = {
  asset:
    'https://github.com/openai/codex/releases/download/rust-v0.159.2/codex-package-x86_64-unknown-linux-musl.tar.gz',
  sha256: createHash('sha256').update(contents).digest('hex'),
  maximumBytes: 1024
}
async function fixture() {
  const directory = resolve('logs/paperclip-runtime-package-tests')
  await mkdir(directory, { recursive: true })
  return mkdtemp(join(directory, 'fixture-'))
}

describe('pinned Codex runtime package', () => {
  it('streams a verified package into the owned cache and reuses the verified bytes', async () => {
    const path = join(await fixture(), 'package.tar.gz')
    const download = vi.fn(async () => new Response(contents))
    expect(await obtainCodexPackage(pin, path, download)).toMatchObject({
      sha256: pin.sha256,
      bytes: contents.byteLength,
      reused: false
    })
    expect(await readFile(path)).toEqual(Buffer.from(contents))
    expect(await obtainCodexPackage(pin, path, download)).toMatchObject({ reused: true })
    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
  })

  it('refuses corrupt cached bytes and leaves them intact for diagnosis', async () => {
    const path = join(await fixture(), 'package.tar.gz')
    await writeFile(path, 'corrupt')
    const download = vi.fn()
    await expect(obtainCodexPackage(pin, path, download)).rejects.toThrow(
      'CODEX_PACKAGE_DIGEST_MISMATCH'
    )
    expect(await readFile(path, 'utf8')).toBe('corrupt')
    expect(download).not.toHaveBeenCalled()
  })

  it.each(['digest', 'capacity', 'redirect'])(
    'refuses a bad %s download and publishes no executable asset',
    async (failure) => {
      const directory = await fixture()
      const path = join(directory, 'package.tar.gz')
      const response = new Response(failure === 'digest' ? 'wrong package' : contents)
      if (failure === 'redirect') {
        Object.defineProperty(response, 'url', { value: 'https://unapproved.example/asset' })
      }
      await expect(
        obtainCodexPackage(
          { ...pin, ...(failure === 'capacity' ? { maximumBytes: 4 } : {}) },
          path,
          async () => response
        )
      ).rejects.toThrow()
      expect(await readdir(directory)).toEqual([])
    }
  )

  it('rejects arbitrary sources and malformed pins before fetching', async () => {
    const path = join(await fixture(), 'package.tar.gz')
    const download = vi.fn()
    for (const change of [
      { asset: 'http://github.com/openai/codex/asset' },
      { asset: 'https://example.com/asset' },
      { sha256: 'latest' },
      { maximumBytes: 0 }
    ]) {
      await expect(obtainCodexPackage({ ...pin, ...change }, path, download)).rejects.toThrow(
        'CODEX_PACKAGE_PIN_INVALID'
      )
    }
    expect(download).not.toHaveBeenCalled()
  })
})
