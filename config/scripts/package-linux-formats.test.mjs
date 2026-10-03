import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { linuxFormatArguments, packageLinuxFormats } from './package-linux-formats.mjs'

let root
let preparedDirectory
let outputDirectory
const targets = ['AppImage', 'deb', 'rpm']
const valueAfter = (args, flag) => args[args.indexOf(flag) + 1]

beforeEach(() => {
  const fixtures = resolve('logs/open-source-baseline/linux-package-marker-closure/fixtures')
  mkdirSync(fixtures, { recursive: true })
  root = mkdtempSync(join(fixtures, 'formats with spaces-'))
  preparedDirectory = join(root, 'prepared app')
  outputDirectory = join(root, 'output packages')
  mkdirSync(join(preparedDirectory, 'resources'), { recursive: true })
  mkdirSync(outputDirectory)
  writeFileSync(join(preparedDirectory, 'resources/package-type'), 'AppImage')
  writeFileSync(join(preparedDirectory, 'resources/app.asar'), 'verified application')
  writeFileSync(join(preparedDirectory, 'orca-ide'), 'executable')
  chmodSync(join(preparedDirectory, 'orca-ide'), 0o755)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function emitPackage(args) {
  const format = valueAfter(args, '--linux')
  const app = valueAfter(args, '--prepackaged')
  const output = valueAfter(args, '--config.directories.output')
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, `orca.${format}`), readFileSync(join(app, 'resources/package-type')))
  writeFileSync(join(output, 'latest-linux.yml'), format)
  return { format, app, output }
}

it('preserves configured hooks, architecture, names, and PR compression with exact argv', () => {
  const args = linuxFormatArguments({
    format: 'deb',
    appDirectory: '/app with spaces',
    outputDirectory: '/out with spaces'
  })
  expect(args).toEqual([
    '--config',
    'config/electron-builder-pr-linux.config.cjs',
    '--linux',
    'deb',
    '--x64',
    '--publish',
    'never',
    '--prepackaged',
    '/app with spaces',
    '--config.directories.output',
    '/out with spaces'
  ])
  expect(() => linuxFormatArguments({ format: 'zip' })).toThrow('Unsupported Linux package format')
})

it.each(['x64', 'arm64'])('preserves the selected release config and %s architecture', (arch) => {
  const args = linuxFormatArguments({
    format: 'rpm',
    appDirectory: '/verified app',
    outputDirectory: '/release packages',
    arch,
    configFile: 'config/electron-builder.config.cjs'
  })
  expect(valueAfter(args, '--config')).toBe('config/electron-builder.config.cjs')
  expect(args.filter((arg) => ['--x64', '--arm64'].includes(arg))).toEqual([`--${arch}`])
  expect(args.some((arg) => arg.includes('compression'))).toBe(false)
})

it('rejects an unsupported architecture before constructing a builder invocation', () => {
  expect(() => linuxFormatArguments({ format: 'deb', arch: 'ia32' })).toThrow(
    'Unsupported Linux package architecture'
  )
})

describe('independent Linux package formats', () => {
  it('starts all formats before awaiting completion and isolates metadata writes', async () => {
    if (process.platform !== 'win32') {
      symlinkSync('resources/package-type', join(preparedDirectory, 'marker-link'))
    }
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const copies = []
    await packageLinuxFormats({
      preparedDirectory,
      outputDirectory,
      runBuilder: async (args) => {
        const app = valueAfter(args, '--prepackaged')
        const format = valueAfter(args, '--linux')
        expect(readFileSync(join(app, 'resources/app.asar'), 'utf8')).toBe('verified application')
        if (process.platform !== 'win32') {
          expect(readlinkSync(join(app, 'marker-link'))).toBe('resources/package-type')
          expect(statSync(join(app, 'orca-ide')).mode & 0o777).toBe(0o755)
          expect(statSync(join(app, 'resources/package-type')).ino).not.toBe(
            statSync(join(preparedDirectory, 'resources/package-type')).ino
          )
        }
        copies.push(app)
        if (copies.length === 3) {
          release()
        }
        await gate
        expect(readFileSync(join(app, 'resources/package-type'), 'utf8')).toBe(format)
        expect(readdirSync(outputDirectory)).toHaveLength(1)
        emitPackage(args)
        await Promise.resolve()
        expect(readFileSync(join(app, 'resources/package-type'), 'utf8')).toBe(format)
      }
    })
    expect(new Set(copies).size).toBe(3)
    expect(readFileSync(join(preparedDirectory, 'resources/package-type'), 'utf8')).toBe('AppImage')
    expect(readFileSync(join(preparedDirectory, 'resources/app.asar'), 'utf8')).toBe(
      'verified application'
    )
    for (const format of targets) {
      expect(readFileSync(join(outputDirectory, `orca.${format}`), 'utf8')).toBe(format)
      expect(
        readFileSync(
          join(outputDirectory, 'linux-package-formats', format, 'latest-linux.yml'),
          'utf8'
        )
      ).toBe(format)
    }
    expect(
      readdirSync(outputDirectory).some((name) => name.startsWith('.linux-package-formats-'))
    ).toBe(false)
  })

  it('settles every worker before cleanup and exposes no partial artifact on failure', async () => {
    const finished = []
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await expect(
      packageLinuxFormats({
        preparedDirectory,
        outputDirectory,
        runBuilder: async (args) => {
          const format = valueAfter(args, '--linux')
          if (format === 'AppImage') {
            throw new Error('compression failed')
          }
          if (format === 'rpm') {
            release()
          }
          await gate
          const { app } = emitPackage(args)
          expect(existsSync(app)).toBe(true)
          finished.push(format)
        }
      })
    ).rejects.toMatchObject({
      message: 'Linux package formats failed',
      errors: [
        expect.objectContaining({
          message: 'AppImage packaging failed',
          cause: expect.objectContaining({ message: 'compression failed' })
        })
      ]
    })
    expect(finished.sort()).toEqual(['deb', 'rpm'])
    expect(readdirSync(outputDirectory)).toEqual([])
    expect(readFileSync(join(preparedDirectory, 'resources/package-type'), 'utf8')).toBe('AppImage')
  })

  it('rejects missing artifacts even when the builder reports success', async () => {
    await expect(
      packageLinuxFormats({
        preparedDirectory,
        outputDirectory,
        runBuilder: async (args) => {
          const result = emitPackage(args)
          if (result.format === 'rpm') {
            writeFileSync(join(result.output, 'orca.rpm'), '')
          }
        }
      })
    ).rejects.toThrow('Linux package formats failed')
    expect(readdirSync(outputDirectory)).toEqual([])
  })

  it('rejects a changed package marker before exposing any completed artifacts', async () => {
    await expect(
      packageLinuxFormats({
        preparedDirectory,
        outputDirectory,
        runBuilder: async (args) => {
          const { format, app } = emitPackage(args)
          if (format === 'deb') {
            writeFileSync(join(app, 'resources/package-type'), 'AppImage')
          }
        }
      })
    ).rejects.toMatchObject({
      message: 'Linux package formats failed',
      errors: [
        expect.objectContaining({
          message: 'deb packaging failed',
          cause: expect.objectContaining({ message: 'deb package marker changed during packaging' })
        })
      ]
    })
    expect(readdirSync(outputDirectory)).toEqual([])
    expect(readFileSync(join(preparedDirectory, 'resources/package-type'), 'utf8')).toBe('AppImage')
  })

  it('does not replace existing output packages', async () => {
    writeFileSync(join(outputDirectory, 'orca.deb'), 'previous package')
    await expect(
      packageLinuxFormats({
        preparedDirectory,
        outputDirectory,
        runBuilder: async (args) => {
          emitPackage(args)
        }
      })
    ).rejects.toThrow('Refusing to replace existing package output')
    expect(readdirSync(outputDirectory)).toEqual(['orca.deb'])
    expect(readFileSync(join(outputDirectory, 'orca.deb'), 'utf8')).toBe('previous package')
  })

  it('rejects a tree already mutated by a previous root-package build', async () => {
    writeFileSync(join(preparedDirectory, 'resources/package-type'), 'rpm')
    await expect(
      packageLinuxFormats({
        preparedDirectory,
        outputDirectory,
        runBuilder: async () => {
          throw new Error('must not run')
        }
      })
    ).rejects.toThrow('Expected a fresh Linux directory build')
    expect(readdirSync(outputDirectory)).toEqual([])
  })
})

it('changes only CI deb/rpm compression levels without mutating release settings or hooks', () => {
  const require = createRequire(import.meta.url)
  const release = require('../electron-builder.config.cjs')
  const before = { deb: { ...release.deb }, rpm: { ...release.rpm } }
  const ci = require('../electron-builder-pr-linux.config.cjs')
  expect(release.deb).toEqual(before.deb)
  expect(release.rpm).toEqual(before.rpm)
  expect(ci).toEqual({
    ...release,
    deb: {
      ...release.deb,
      compression: 'gz',
      fpm: [...(release.deb.fpm ?? []), '--deb-compression-level=1']
    },
    rpm: {
      ...release.rpm,
      compression: 'gzip',
      fpm: [...(release.rpm.fpm ?? []), '--rpm-compression-level=1']
    }
  })
})
