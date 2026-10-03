import { beforeEach, expect, it, vi } from 'vitest'
import { listCliCommandCandidates } from './cli-command-candidates'

const files = vi.hoisted(() => new Map<string, { text: string; dangling?: boolean }>())
vi.mock('node:fs', () => ({
  statSync: (file: string) => {
    const entry = files.get(file)
    if (!entry || entry.dangling) {
      throw new Error('ENOENT')
    }
    return { isFile: () => true, size: entry.text.length }
  },
  lstatSync: (file: string) => {
    const entry = files.get(file)
    if (!entry) {
      throw new Error('ENOENT')
    }
    return {
      isFile: () => !entry.dangling,
      isSymbolicLink: () => Boolean(entry.dangling),
      size: entry.text.length
    }
  },
  readFileSync: (file: string) => files.get(file)?.text
}))
vi.mock('./node-cli-command-resolution', () => ({
  getCliInstallDirectories: () => [],
  getExecutableNames: (platform: string, command: string) =>
    platform === 'win32'
      ? [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command]
      : [command]
}))
beforeEach(() => files.clear())

it('does not report the POSIX companion of a Windows npm shim as a second installation', () => {
  files.set('C:\\npm\\codex.cmd', { text: '@echo off' })
  files.set('C:\\npm\\codex', { text: '#!/bin/sh\nexec node codex.js "$@"' })
  expect(listCliCommandCandidates('codex', { platform: 'win32', pathEnv: 'C:\\npm' })).toEqual([
    'C:\\npm\\codex.cmd'
  ])
})

it('keeps an independent extensionless Windows executable', () => {
  files.set('C:\\native\\codex', { text: 'MZ executable' })
  expect(listCliCommandCandidates('codex', { platform: 'win32', pathEnv: 'C:\\native' })).toEqual([
    'C:\\native\\codex'
  ])
})

it('retains a dangling installation symlink for diagnosis', () => {
  files.set('/tools/codex', { text: '', dangling: true })
  expect(listCliCommandCandidates('codex', { platform: 'linux', pathEnv: '/tools' })).toEqual([
    '/tools/codex'
  ])
})
