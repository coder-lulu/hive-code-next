import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256, targets } from './client-build-contract.mjs'

const execution = vi.hoisted(() => ({ nodeStep: vi.fn(), step: vi.fn(), pnpmStep: vi.fn() }))
vi.mock('./client-build-execution.mjs', () => execution)
vi.mock('./package-linux-formats-appimage.mjs', () => ({
  preparePrAppImageTools: vi.fn(async () => ({}))
}))
import { buildDesktop } from './client-build-desktop.mjs'
import { preparePrAppImageTools } from './package-linux-formats-appimage.mjs'

const require = createRequire(import.meta.url)
const config = require('../electron-builder.config.cjs')
const {
  configureBuildCommand,
  createYargs,
  normalizeOptions
} = require('electron-builder/out/builder')
const { computeArchToTargetNamesMap } = require('app-builder-lib/out/targets/targetFactory')
const { Platform, Arch } = require('electron-builder')
const builder = 'node_modules/electron-builder/cli.js'
const configFile = 'config/electron-builder.config.cjs'
const formats = ['AppImage', 'deb', 'rpm']
const valueAfter = (args, flag) => args[args.indexOf(flag) + 1]
let fixture
let context
let calls
let failDirectory
let changeMarker

function write(file, bytes) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, bytes)
}

function outputPath(args) {
  return args
    .find((arg) => arg.startsWith('-c.directories.output='))
    ?.split('=')
    .slice(1)
    .join('=')
}

function preparedPath(output, arch) {
  return join(output, arch === 'x64' ? 'linux-unpacked' : 'linux-arm64-unpacked')
}

function resolveLinuxTargets(args) {
  const options = normalizeOptions(configureBuildCommand(createYargs()).parseSync(args))
  expect([...options.targets.keys()]).toEqual([Platform.LINUX])
  return computeArchToTargetNamesMap(
    options.targets.get(Platform.LINUX),
    { platformSpecificBuildOptions: config.linux },
    Platform.LINUX
  )
}

beforeEach(() => {
  const logs = resolve('logs/open-source-baseline/linux-package-marker-closure/fixtures')
  mkdirSync(logs, { recursive: true })
  fixture = mkdtempSync(join(logs, 'desktop-'))
  context = {
    root: fixture,
    home: join(fixture, 'home'),
    work: join(fixture, 'work'),
    attempt: 'one',
    local: {},
    toolchain: { electron: '43.7.5' },
    pkg: { version: '1.5.0-beta.24' },
    env: { npm_config_offline: 'true', NODE_OPTIONS: '--require=owned-offline-guard.cjs' }
  }
  write(
    join(context.home, 'cache/electron-headers/43.7.5/node-v43.7.5/include/node/node.h'),
    'header'
  )
  const headersCache = join(context.home, 'cache/electron-headers/43.7.5')
  const archive = 'node-v43.7.5-headers.tar.gz'
  const headerBytes = Buffer.from('checked archive')
  const libraryBytes = Buffer.from('checked import library')
  write(join(headersCache, archive), headerBytes)
  write(join(headersCache, `node-v43.7.5/${process.arch}/node.lib`), libraryBytes)
  write(
    join(headersCache, 'SHASUMS256.txt'),
    [
      `${sha256(headerBytes)}  ${archive}`,
      `${sha256(libraryBytes)}  win-${process.arch}/node.lib`
    ].join('\n')
  )
  write(join(fixture, 'node_modules/electron/dist/version'), '43.7.5')
  write(join(fixture, 'node_modules/electron/dist/electron'), 'original runtime')
  calls = []
  failDirectory = false
  changeMarker = undefined
  vi.clearAllMocks()
  execution.nodeStep.mockImplementation(async (receivedContext, label, script, args) => {
    calls.push({ context: receivedContext, label, script, args, env: { ...receivedContext.env } })
    if (script === builder && args.includes('--linux') && !args.includes('--prepackaged')) {
      if (failDirectory) {
        throw new Error('directory native validation failed')
      }
      expect(valueAfter(args, '--linux')).toBe('dir')
      const arch = args.includes('--arm64') ? 'arm64' : 'x64'
      const prepared = preparedPath(outputPath(args), arch)
      write(join(prepared, 'resources/package-type'), 'AppImage')
      write(join(prepared, 'resources/app.asar'), 'verified application')
    } else if (script === builder && args.includes('--prepackaged')) {
      const format = valueAfter(args, '--linux')
      const app = valueAfter(args, '--prepackaged')
      expect(readFileSync(join(app, 'resources/package-type'), 'utf8')).toBe(format)
      expect(readFileSync(join(app, 'resources/app.asar'), 'utf8')).toBe('verified application')
      write(join(valueAfter(args, '--config.directories.output'), `desktop.${format}`), format)
      if (changeMarker === format) {
        write(join(app, 'resources/package-type'), 'AppImage')
      }
    } else if (label === 'headless-runtime-package') {
      write(join(outputPath(args), `${config.linux.executableName}-runtime_fixture.deb`), 'runtime')
    }
  })
  execution.step.mockImplementation(async (_context, label, program, args) => {
    expect(label).toBe('web-client-package')
    expect(program).toBe('tar')
    write(args[1], 'web client')
  })
})

afterEach(() => rmSync(fixture, { recursive: true, force: true }))

describe('formal desktop packaging execution', () => {
  it.each(['x64', 'arm64'])(
    'packages Linux %s from one verified directory with isolated format markers',
    async (arch) => {
      const name = `linux-${arch}`
      const output = await buildDesktop(context, name, false)
      expect(output).toBe(join(context.work, name, 'package', context.pkg.version, context.attempt))
      const packaging = calls.filter(({ script }) => script === builder)
      expect(packaging).toHaveLength(4)
      expect(packaging[0].label).toBe('desktop-package')
      expect(packaging[0].args).toEqual([
        '--config',
        configFile,
        '--linux',
        'dir',
        `--${arch}`,
        '--publish',
        'never',
        `-c.directories.output=${output}`,
        `-c.electronDist=${join(context.work, name, 'electron')}`
      ])
      expect(calls[0].label).toBe('desktop-native')
      expect(execution.pnpmStep).toHaveBeenCalledWith(context, 'desktop-compile', [
        'run',
        'build:desktop'
      ])
      const formatCalls = packaging.slice(1)
      expect(formatCalls.map(({ label }) => label).sort()).toEqual(
        formats.map((format) => `desktop-package-${format}`).sort()
      )
      expect(preparePrAppImageTools).not.toHaveBeenCalled()
      expect(new Set(formatCalls.map(({ args }) => valueAfter(args, '--prepackaged'))).size).toBe(3)
      for (const call of packaging) {
        expect(call.context).toBe(context)
        expect(call.env).toMatchObject({
          npm_config_offline: 'true',
          NODE_OPTIONS: '--require=owned-offline-guard.cjs',
          npm_config_nodedir: join(context.home, 'cache/electron-headers/43.7.5/node-v43.7.5'),
          ORCA_LINUX_ARM64_RELEASE: arch === 'arm64' ? '1' : '0'
        })
        expect(valueAfter(call.args, '--config')).toBe(configFile)
        expect(call.args.filter((arg) => ['--x64', '--arm64'].includes(arg))).toEqual([`--${arch}`])
        expect(call.args.some((arg) => arg.includes('compression'))).toBe(false)
        expect([...resolveLinuxTargets(call.args)]).toEqual([
          [Arch[arch], [valueAfter(call.args, '--linux')]]
        ])
      }
      const prepared = preparedPath(output, arch)
      expect(readFileSync(join(prepared, 'resources/package-type'), 'utf8')).toBe('AppImage')
      expect(readFileSync(join(prepared, 'resources/app.asar'), 'utf8')).toBe(
        'verified application'
      )
      for (const format of formats) {
        expect(readFileSync(join(output, `desktop.${format}`), 'utf8')).toBe(format)
      }
      expect(calls.at(-1).label).toBe('headless-runtime-package')
      expect(
        readFileSync(join(output, `${config.linux.executableName}-runtime_fixture.deb`), 'utf8')
      ).toBe('runtime')
      expect(execution.step).toHaveBeenCalledTimes(arch === 'x64' ? 1 : 0)
      if (arch === 'x64') {
        expect(execution.step).toHaveBeenCalledWith(context, 'web-client-package', 'tar', [
          '-czf',
          join(output, `${config.productName}-Web-${context.pkg.version}.tar.gz`),
          '-C',
          join(context.root, 'out'),
          'web',
          'mobile-web'
        ])
      }
      expect(readFileSync(join(fixture, 'node_modules/electron/dist/electron'), 'utf8')).toBe(
        'original runtime'
      )
    }
  )

  it.each(['windows-x64', 'macos-x64', 'macos-arm64'])(
    'preserves the existing %s builder and native steps',
    async (name) => {
      const output = await buildDesktop(context, name, false)
      expect(output).toBe(join(context.work, name, 'package', context.pkg.version))
      expect(calls.filter(({ script }) => script === builder)).toEqual([
        expect.objectContaining({
          label: 'desktop-package',
          args: [
            '--config',
            configFile,
            ...targets[name].builder,
            '--publish',
            'never',
            `-c.directories.output=${output}`,
            `-c.electronDist=${join(context.work, name, 'electron')}`
          ]
        })
      ])
      expect(calls.map(({ label }) => label)).toEqual(['desktop-native', 'desktop-package'])
      expect(execution.pnpmStep.mock.calls.map(([, label]) => label)).toEqual([
        'desktop-compile',
        ...(name.startsWith('macos')
          ? [
              'build-computer-macos',
              'build-keyboard-layout-macos',
              'build-notification-status-macos'
            ]
          : [])
      ])
      expect(execution.step).not.toHaveBeenCalled()
    }
  )

  it('prepares then builds the same version in separate attempts without changing prior packages', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('cached headers must not download'))
    try {
      context.attempt = 'prepare-one'
      delete context.env.npm_config_offline
      const first = await buildDesktop(context, 'linux-x64', true)
      const packageNames = [
        ...formats.map((format) => `desktop.${format}`),
        `${config.linux.executableName}-runtime_fixture.deb`
      ]
      const before = packageNames.map((name) => readFileSync(join(first, name)))
      context.attempt = 'build-two'
      context.env.npm_config_offline = 'true'
      const second = await buildDesktop(context, 'linux-x64', false)
      expect(second).not.toBe(first)
      expect(first).toBe(
        join(context.work, 'linux-x64/package', context.pkg.version, 'prepare-one')
      )
      expect(second).toBe(join(context.work, 'linux-x64/package', context.pkg.version, 'build-two'))
      for (const [index, name] of packageNames.entries()) {
        expect(readFileSync(join(first, name))).toEqual(before[index])
        expect(readFileSync(join(second, name))).toEqual(before[index])
      }
      expect(
        calls
          .filter(({ label }) => label === 'headless-runtime-package')
          .map(({ args }) => outputPath(args))
      ).toEqual([
        join(context.work, 'linux-x64/headless-runtime', context.pkg.version, 'prepare-one'),
        join(context.work, 'linux-x64/headless-runtime', context.pkg.version, 'build-two')
      ])
      expect(execution.step).toHaveBeenCalledTimes(2)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })

  it('starts no format or downstream package when directory validation fails', async () => {
    failDirectory = true
    await expect(buildDesktop(context, 'linux-x64', false)).rejects.toThrow(
      'directory native validation failed'
    )
    expect(calls.map(({ label }) => label)).toEqual(['desktop-native', 'desktop-package'])
    expect(execution.step).not.toHaveBeenCalled()
  })

  it('exposes no format package or downstream runtime after a marker mismatch', async () => {
    changeMarker = 'deb'
    await expect(buildDesktop(context, 'linux-arm64', false)).rejects.toThrow(
      'Linux package formats failed'
    )
    expect(calls.filter(({ args }) => args.includes('--prepackaged'))).toHaveLength(3)
    expect(calls.some(({ label }) => label === 'headless-runtime-package')).toBe(false)
    expect(execution.step).not.toHaveBeenCalled()
    const output = join(context.work, 'linux-arm64/package', context.pkg.version, context.attempt)
    expect(readdirSync(output)).toEqual(['linux-arm64-unpacked'])
    expect(existsSync(join(output, 'desktop.AppImage'))).toBe(false)
  })
})
