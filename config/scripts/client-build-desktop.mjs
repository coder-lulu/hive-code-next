import {
  cpSync,
  copyFileSync,
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
import { packageLinuxFormats } from './package-linux-formats.mjs'

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

function headerChecksum(sums, file) {
  const line = sums
    .split(/\r?\n/)
    .find((entry) => entry.trim().endsWith(` ${file}`) || entry.trim().endsWith(` *${file}`))
  if (!line || !/^[a-f0-9]{64}\s/i.test(line)) {
    throw new Error(`Missing official checksum for ${file}`)
  }
  return line.slice(0, 64)
}

export function matchesElectronHeaderChecksums(sums, version, platform, arch) {
  try {
    headerChecksum(sums, `node-v${version}-headers.tar.gz`)
    if (platform === 'win32') {
      headerChecksum(sums, `win-${arch}/node.lib`)
    }
    return true
  } catch {
    return false
  }
}

export async function prepareElectronHeaders(context) {
  const version = context.toolchain.electron
  const base = `https://artifacts.electronjs.org/headers/dist/v${version}`
  const cache = join(context.home, 'cache', 'electron-headers', version)
  mkdirSync(cache, { recursive: true })
  const sumFile = join(cache, 'SHASUMS256.txt')
  const imported = context.local.electronHeadersImport
  if (imported && !existsSync(sumFile)) {
    const importedSums = join(imported, 'SHASUMS256.txt')
    if (
      existsSync(importedSums) &&
      matchesElectronHeaderChecksums(
        readFileSync(importedSums, 'utf8'),
        version,
        process.platform,
        process.arch
      )
    ) {
      cpSync(importedSums, sumFile)
      cpSync(join(imported, 'headers.tar.gz'), join(cache, `node-v${version}-headers.tar.gz`))
    }
  }
  if (
    !existsSync(sumFile) ||
    !matchesElectronHeaderChecksums(
      readFileSync(sumFile, 'utf8'),
      version,
      process.platform,
      process.arch
    )
  ) {
    const response = await fetch(`${base}/SHASUMS256.txt`, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) {
      throw new Error('Cannot retrieve official Electron header checksums')
    }
    const officialSums = await response.text()
    if (!matchesElectronHeaderChecksums(officialSums, version, process.platform, process.arch)) {
      throw new Error('Official Electron header checksums do not match the pinned version')
    }
    writeCache(sumFile, officialSums)
  }
  const sums = readFileSync(sumFile, 'utf8')
  const expected = (file) => headerChecksum(sums, file)
  const archive = `node-v${version}-headers.tar.gz`
  await downloadChecked(`${base}/${archive}`, join(cache, archive), expected(archive))
  const extracted = join(cache, `node-v${version}`)
  if (!existsSync(join(extracted, 'include/node/node.h'))) {
    mkdirSync(extracted, { recursive: true })
    await step(
      context,
      'electron-headers-extract',
      'tar',
      ['-xzf', archive, '--strip-components=1', '-C', `node-v${version}`],
      cache
    )
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
  const output = join(
    context.work,
    name,
    'package',
    context.pkg.version,
    ...(target.host === 'linux' ? [context.attempt] : [])
  )
  const configFile = 'config/electron-builder.config.cjs'
  context.env.ORCA_LINUX_ARM64_RELEASE = name === 'linux-arm64' ? '1' : '0'
  await nodeStep(context, 'desktop-package', 'node_modules/electron-builder/cli.js', [
    '--config',
    configFile,
    ...(target.host === 'linux' ? ['--linux', 'dir', `--${target.arch}`] : target.builder),
    '--publish',
    'never',
    `-c.directories.output=${output}`,
    `-c.electronDist=${staging}`
  ])
  if (target.host === 'linux') {
    await packageLinuxFormats({
      preparedDirectory: join(
        output,
        target.arch === 'x64' ? 'linux-unpacked' : 'linux-arm64-unpacked'
      ),
      outputDirectory: output,
      arch: target.arch,
      configFile,
      runBuilder: (args) =>
        nodeStep(
          context,
          `desktop-package-${args[args.indexOf('--linux') + 1]}`,
          'node_modules/electron-builder/cli.js',
          args
        )
    })
    const runtimeOutput = join(
      context.work,
      name,
      'headless-runtime',
      context.pkg.version,
      context.attempt
    )
    await nodeStep(
      context,
      'headless-runtime-package',
      'config/scripts/build-linux-runtime-deb.mjs',
      [`-c.directories.output=${runtimeOutput}`, `-c.electronDist=${staging}`]
    )
    const runtimePackages = readdirSync(runtimeOutput).filter((file) =>
      /^hivecode-runtime_.*\.deb$/.test(file)
    )
    if (runtimePackages.length !== 1) {
      throw new Error('A single headless runtime .deb is required')
    }
    copyFileSync(join(runtimeOutput, runtimePackages[0]), join(output, runtimePackages[0]))
  }
  if (name === 'linux-x64') {
    await step(context, 'web-client-package', 'tar', [
      '-czf',
      join(output, `HiveCode-Web-${context.pkg.version}.tar.gz`),
      '-C',
      join(context.root, 'out'),
      'web',
      'mobile-web'
    ])
  }
  return output
}
