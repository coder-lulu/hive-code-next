import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTaskDockerRuntimeConfiguration } from './task-docker-runtime-configuration'
import { ENDPOINT, IMAGE } from './task-docker-boundary.test-fixture'

let directory: string
let path: string
beforeEach(async () => {
  const root = resolve('logs/paperclip-development/p3/controlled-runtime/configuration/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'config-'))
  await mkdir(join(directory, 'hive-tasks'))
  path = join(directory, 'hive-tasks', 'docker-runtime.json')
})
afterEach(async () => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  await rm(directory, { recursive: true, force: true })
})
const configuration = () => ({ dockerPath: process.execPath, endpoint: ENDPOINT, imageId: IMAGE })
const unavailable = () =>
  expect(() => readTaskDockerRuntimeConfiguration(directory)).toThrow(
    'TASK_DOCKER_RUNTIME_UNAVAILABLE'
  )

describe('controlled Docker deployment configuration', () => {
  it('returns detached immutable deployment data without qualifying a daemon or credentials', async () => {
    await writeFile(path, JSON.stringify(configuration()))
    const value = readTaskDockerRuntimeConfiguration(directory)
    expect(value).toEqual(configuration())
    expect(Object.isFrozen(value)).toBe(true)
  })
  it('reports absent deployment explicitly', () => unavailable())
  it.each([
    { dockerPath: 'docker' },
    { dockerPath: `${process.execPath}\n` },
    { endpoint: `${ENDPOINT}\0` },
    { imageId: 'worker:latest' },
    { imageId: IMAGE.toUpperCase() },
    { unexpected: 'not-a-capability' }
  ])('refuses malformed deployment data (%j)', async (change) => {
    await writeFile(path, JSON.stringify({ ...configuration(), ...change }))
    unavailable()
  })
  it('bounds the configuration file size', async () => {
    await writeFile(path, ' '.repeat(16385) + JSON.stringify(configuration()))
    unavailable()
  })
  it('bounds growth between the initial file observation and read', async () => {
    await writeFile(path, JSON.stringify(configuration()))
    const original = fs.lstatSync
    vi.spyOn(fs, 'lstatSync').mockImplementationOnce((...args) => {
      const stat = original(...args)
      fs.writeFileSync(path, ' '.repeat(16385) + JSON.stringify(configuration()))
      return stat
    })
    syncBuiltinESMExports()
    unavailable()
  })
  it('refuses a directory instead of a regular configuration file', async () => {
    await mkdir(path)
    unavailable()
  })
  it('sanitizes invalid JSON without returning file contents', async () => {
    await writeFile(path, '{ invalid private configuration')
    unavailable()
  })
})
