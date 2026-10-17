import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

const require = createRequire(import.meta.url)

// Resource-pruning and launcher-permission fixtures contain only their own required artifacts.
// Scope package-wide updater artifact checks to this fresh config instance.
export function createAfterPackFixture() {
  const updater = require('../packaged-updater-security-boundary.cjs')
  const configPath = require.resolve('../electron-builder.config.cjs')
  const previousConfig = require.cache[configPath]
  const verifyUpdater = updater.verifyPackagedUpdaterSecurityBoundary
  try {
    updater.verifyPackagedUpdaterSecurityBoundary = () => undefined
    delete require.cache[configPath]
    return require(configPath)
  } finally {
    updater.verifyPackagedUpdaterSecurityBoundary = verifyUpdater
    if (previousConfig) {
      require.cache[configPath] = previousConfig
    } else {
      delete require.cache[configPath]
    }
  }
}

// Non-ELF stand-ins retain the real existence and executable-bit checks.
export async function seedBundledRipgrep(resourcesDir) {
  const { BUNDLED_RIPGREP_PLATFORMS } = require('../bundled-ripgrep-resources.cjs')
  for (const platform of BUNDLED_RIPGREP_PLATFORMS) {
    const dir = join(resourcesDir, 'ripgrep', platform)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, platform.startsWith('win32-') ? 'rg.exe' : 'rg'), '', 'utf8')
  }
}

// Headers model architecture; objdump is stubbed for these packaging-layout tests.
export async function seedClipboardPublisher(resourcesDir, machine) {
  const binDir = join(resourcesDir, 'bin')
  await mkdir(binDir, { recursive: true })
  const elf = Buffer.alloc(64)
  elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
  elf.writeUInt16LE(2, 16)
  elf.writeUInt16LE(machine, 18)
  elf.writeUInt32LE(1, 20)
  elf.writeUInt16LE(64, 52)
  await writeFile(join(binDir, 'orca-wayland-clipboard'), elf)
}

export async function stubObjdump(root) {
  const directory = join(root, 'bin')
  await mkdir(directory)
  await writeFile(join(directory, 'objdump'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  process.env.PATH = `${directory}${delimiter}${process.env.PATH ?? ''}`
}
