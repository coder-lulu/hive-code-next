import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  loadContext,
  selectTargets,
  dependencyFingerprint,
  installedResourceFingerprint,
  sha256,
  hasPreparedResources
} from './client-build-contract.mjs'
import { acquireBuildLock, capture, pnpmStep, pnpmCommand } from './client-build-execution.mjs'
import { androidPreflight, buildAndroid } from './client-build-android.mjs'
import { iosPreflight, buildIOS } from './client-build-ios.mjs'
import { buildDesktop } from './client-build-desktop.mjs'
import { deliverArtifacts, verifyArtifacts } from './client-build-artifacts.mjs'
import { canReuseInstalledDependencies } from './client-build-install.mjs'

const root = resolve(import.meta.dirname, '../..')
const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  allowPositionals: true,
  options: { target: { type: 'string', default: 'all' } }
})
const command = positionals[0]
if (!['doctor', 'prepare', 'build'].includes(command) || positionals.length !== 1) {
  throw new Error(
    'Usage: clients:doctor|prepare|build -- --target all|desktop|android|<platform-arch>'
  )
}
const names = selectTargets(values.target)
const context = loadContext(root)
context.attempt = new Date().toISOString().replaceAll(/[-:.]/g, '')
context.logs = join(root, 'logs', 'client-build', context.attempt)

async function preflight() {
  if (process.versions.node !== context.toolchain.node) {
    throw new Error(`Node ${context.toolchain.node} required; got ${process.versions.node}`)
  }
  const pnpm = pnpmCommand(['--version'])
  const pnpmVersion = await capture(context, pnpm.program, pnpm.args)
  if (pnpmVersion !== context.toolchain.pnpm) {
    throw new Error(`pnpm ${context.toolchain.pnpm} required`)
  }
  if (names.includes('android')) {
    await androidPreflight(context)
  }
  if (names.includes('ios')) {
    await iosPreflight(context)
  }
  if (names.includes('windows-x64')) {
    const vswhere = join(
      context.env['ProgramFiles(x86)'],
      'Microsoft Visual Studio/Installer/vswhere.exe'
    )
    const installation = await capture(context, vswhere, [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath'
    ])
    const msvc = readFileSync(
      join(installation, 'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt'),
      'utf8'
    ).trim()
    if (msvc !== context.release.windows.msvc) {
      throw new Error(`MSVC ${context.release.windows.msvc} required; found ${msvc}`)
    }
    context.env.npm_config_msvs_version = '2022'
  }
  if (names.some((name) => name.startsWith('linux'))) {
    await capture(context, 'rpmbuild', ['--version'])
    await capture(context, 'objdump', ['--version'])
  }
  if (names.some((name) => name.startsWith('macos'))) {
    await capture(context, 'xcodebuild', ['-version'])
  }
  console.log(
    `[clients] Toolchain verified; targets=${names.join(', ')}; cache=${context.home}; output=${context.output}`
  )
}

async function main() {
  await preflight()
  if (command === 'doctor') {
    for (const name of names) {
      console.log(
        `[clients] ${name}: ${hasPreparedResources(context, name) ? 'prepared' : 'run clients:prepare'}`
      )
    }
    return
  }
  const unlock = acquireBuildLock(root)
  try {
    const commit = await capture(context, 'git', ['rev-parse', 'HEAD'])
    const status = await capture(context, 'git', ['status', '--porcelain'])
    const diff = await capture(context, 'git', ['diff', 'HEAD', '--binary'])
    const untracked = await capture(context, 'git', [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z'
    ])
    context.source = {
      commit,
      dirty: Boolean(status),
      trackedDiffSha256: sha256(diff),
      untracked: untracked
        .split('\0')
        .filter(Boolean)
        .map((file) => ({ file, sha256: sha256(readFileSync(join(root, file))) }))
    }
    context.env.HIVECODE_COMMIT_SHA = commit
    context.env.ORCA_BUILD_COMMIT = commit
    if (command === 'build') {
      context.env.npm_config_offline = 'true'
      context.env.ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
      for (const key of [
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'ALL_PROXY',
        'http_proxy',
        'https_proxy',
        'all_proxy'
      ]) {
        context.env[key] = 'http://127.0.0.1:9'
      }
      context.env.NO_PROXY = context.env.no_proxy = 'localhost,127.0.0.1,::1'
      const preload = join(root, 'config/scripts/client-build-offline.cjs')
      context.env.NODE_OPTIONS += ` --require=${JSON.stringify(process.platform === 'win32' ? preload.replaceAll('\\', '/') : preload)}`
      for (const name of names) {
        if (!hasPreparedResources(context, name)) {
          throw new Error(
            `${name} resources are missing or stale; run clients:prepare -- --target ${name}`
          )
        }
      }
    }
    for (const name of names) {
      context.logs = join(root, 'logs', 'client-build', context.attempt, name)
      const receipt = join(context.work, name, 'prepared.json')
      if (command === 'prepare') {
        const mobileTarget = ['android', 'ios'].includes(name)
        const cwd = mobileTarget ? join(root, 'mobile') : root
        mkdirSync(join(context.work, name), { recursive: true })
        if (!canReuseInstalledDependencies(context, name)) {
          await pnpmStep(
            context,
            `${name}-install`,
            [
              'install',
              '--frozen-lockfile',
              '--store-dir',
              context.store,
              ...(mobileTarget ? ['--node-linker=hoisted'] : ['--ignore-scripts'])
            ],
            cwd
          )
        }
      }
      const source =
        name === 'android'
          ? await buildAndroid(context, command === 'prepare')
          : name === 'ios'
            ? await buildIOS(context, command === 'prepare')
            : await buildDesktop(context, name, command === 'prepare')
      const verified = await verifyArtifacts(context, name, source)
      const fingerprint = dependencyFingerprint(context, name)
      const output = deliverArtifacts(context, name, verified, fingerprint)
      writeFileSync(
        receipt,
        JSON.stringify(
          {
            fingerprint,
            resources: installedResourceFingerprint(context, name),
            output,
            preparedAt: new Date().toISOString()
          },
          null,
          2
        )
      )
    }
  } finally {
    unlock()
  }
}

main().catch((error) => {
  console.error(`[clients] ${error.message}`)
  process.exitCode = 1
})
