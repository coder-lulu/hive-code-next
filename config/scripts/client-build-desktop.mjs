import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  chmodSync,
  lstatSync,
  readdirSync,
  realpathSync,
  renameSync
} from 'node:fs'
import { join } from 'node:path'
import { nodeStep, step, pnpmStep } from './client-build-execution.mjs'
import { sha256, targets } from './client-build-contract.mjs'

function writeCache(file, data) {
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, data)
  renameSync(temporary, file)
}

export function copyWritableElectronRuntime(source, destination) {
  const writable = (directory) => {
    if (!existsSync(directory)) {
      return
    }
    if (lstatSync(directory).isSymbolicLink()) {
      throw new Error('Electron staging root cannot be a link')
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) {
        writable(file)
      } else if (entry.isFile()) {
        chmodSync(file, statSync(file).mode | 0o200)
      }
    }
  }
  writable(destination)
  cpSync(realpathSync(source), destination, {
    recursive: true,
    force: true,
    verbatimSymlinks: true
  })
  writable(destination)
}

async function downloadChecked(url, destination, expected) {
  if (existsSync(destination) && sha256(readFileSync(destination)) === expected) {
    return
  }
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!response.ok) {
        throw new Error(`Resource download returned HTTP ${response.status}`)
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (sha256(bytes) !== expected) {
        throw new Error('Resource checksum mismatch')
      }
      writeCache(destination, bytes)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`Cannot prepare ${url}: ${lastError.message}`, { cause: lastError })
}

export async function prepareElectronHeaders(context) {
  const version = context.toolchain.electron
  const base = `https://artifacts.electronjs.org/headers/dist/v${version}`
  const cache = join(context.home, 'cache', 'electron-headers', version)
  mkdirSync(cache, { recursive: true })
  const sumFile = join(cache, 'SHASUMS256.txt')
  const imported = context.local.electronHeadersImport
  if (imported && !existsSync(sumFile)) {
    cpSync(join(imported, 'SHASUMS256.txt'), sumFile)
    cpSync(join(imported, 'headers.tar.gz'), join(cache, `node-v${version}-headers.tar.gz`))
  }
  if (!existsSync(sumFile)) {
    const response = await fetch(`${base}/SHASUMS256.txt`, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) {
      throw new Error('Cannot retrieve official Electron header checksums')
    }
    writeCache(sumFile, await response.text())
  }
  const sums = readFileSync(sumFile, 'utf8')
  const expected = (file) => {
    const line = sums
      .split(/\r?\n/)
      .find((line) => line.trim().endsWith(` ${file}`) || line.trim().endsWith(` *${file}`))
    if (!line || !/^[a-f0-9]{64}\s/i.test(line)) {
      throw new Error(`Missing official checksum for ${file}`)
    }
    return line.slice(0, 64)
  }
  const archive = `node-v${version}-headers.tar.gz`
  await downloadChecked(`${base}/${archive}`, join(cache, archive), expected(archive))
  const extracted = join(cache, `node-v${version}`)
  if (!existsSync(join(extracted, 'include/node/node.h'))) {
    mkdirSync(extracted, { recursive: true })
    await step(context, 'electron-headers-extract', 'tar', [
      '-xzf',
      join(cache, archive),
      '--strip-components=1',
      '-C',
      extracted
    ])
  }
  if (!existsSync(join(extracted, 'include/node/node.h'))) {
    throw new Error('Electron header archive has an unexpected layout')
  }
  if (process.platform === 'win32') {
    mkdirSync(join(extracted, process.arch), { recursive: true })
    if (
      imported &&
      existsSync(join(imported, 'node.lib')) &&
      !existsSync(join(extracted, process.arch, 'node.lib'))
    ) {
      cpSync(join(imported, 'node.lib'), join(extracted, process.arch, 'node.lib'))
    }
    await downloadChecked(
      `${base}/win-${process.arch}/node.lib`,
      join(extracted, process.arch, 'node.lib'),
      expected(`win-${process.arch}/node.lib`)
    )
    // Electron's custom-nodedir rebuild resolves the import library under Release.
    mkdirSync(join(extracted, 'Release'), { recursive: true })
    cpSync(join(extracted, process.arch, 'node.lib'), join(extracted, 'Release', 'node.lib'))
  }
  context.env.npm_config_nodedir = extracted
}

export async function buildDesktop(context, name, online) {
  const target = targets[name]
  const headers = join(
    context.home,
    'cache/electron-headers',
    context.toolchain.electron,
    `node-v${context.toolchain.electron}`
  )
  if (online) {
    await prepareElectronHeaders(context)
  } else if (!existsSync(join(headers, 'include/node/node.h'))) {
    throw new Error('Electron headers missing; run clients:prepare')
  }
  context.env.npm_config_nodedir = headers
  await nodeStep(context, 'desktop-native', 'config/scripts/ensure-native-runtime.mjs', [
    '--runtime=electron'
  ])
  await pnpmStep(context, 'desktop-compile', ['run', 'build:desktop'])
  if (target.host === 'darwin') {
    for (const script of [
      'build:computer-macos',
      'build:keyboard-layout-macos',
      'build:notification-status-macos'
    ]) {
      await pnpmStep(context, script.replaceAll(':', '-'), ['run', script])
    }
  }
  const source = join(context.root, 'node_modules/electron/dist')
  if (readFileSync(join(source, 'version'), 'utf8').trim() !== context.toolchain.electron) {
    throw new Error('Installed Electron binary version differs')
  }
  const staging = join(context.work, name, 'electron')
  // Copy, never hard-link: electron-builder edits the executable's resources.
  copyWritableElectronRuntime(source, staging)
  const output = join(context.work, name, 'package', context.pkg.version)
  context.env.ORCA_LINUX_ARM64_RELEASE = name === 'linux-arm64' ? '1' : '0'
  await nodeStep(context, 'desktop-package', 'node_modules/electron-builder/cli.js', [
    '--config',
    'config/electron-builder.config.cjs',
    ...target.builder,
    '--publish',
    'never',
    `-c.directories.output=${output}`,
    `-c.electronDist=${staging}`
  ])
  return output
}
