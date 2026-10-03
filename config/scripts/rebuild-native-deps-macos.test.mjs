import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeTreeSync } from '../../src/shared/windows-transient-lock-removal.ts'
import {
  mkTempProject,
  runRebuildScript,
  writeFakeElectronRebuild,
  writeFakeNodePtyConptyPayload,
  writeFakeNodePtyConptySource,
  writeFakeUsableElectronPackage
} from './rebuild-native-deps-test-fixtures.mjs'

const patchedBindingGyp = `{
  'target_defaults': {
    'defines': [ 'NAPI_CPP_EXCEPTIONS' ],
    'cflags_cc': [ '-std=gnu++2a' ],
    'conditions': [
      ['OS=="mac"', {
        'xcode_settings': {
          'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
          'CLANG_CXX_LIBRARY': 'libc++',
          'MACOSX_DEPLOYMENT_TARGET': '10.7',
        },
      }],
    ],
  },
  'targets': [ { 'target_name': 'pty', 'sources': ['src/unix/pty.cc'] } ],
}`

function prepareProject(platform, bindingGyp = patchedBindingGyp) {
  const projectDir = mkTempProject()
  writeFakeUsableElectronPackage(projectDir, { platform })
  writeFakeElectronRebuild(projectDir, {
    logPathEnv: 'ORCA_REBUILD_TEST_LOG',
    captureNodePtyBindingGyp: true
  })
  const bindingPath = join(projectDir, 'node_modules', 'node-pty', 'binding.gyp')
  mkdirSync(join(projectDir, 'node_modules', 'node-pty'), { recursive: true })
  writeFileSync(bindingPath, bindingGyp)
  return { projectDir, bindingPath, logPath: join(projectDir, 'electron-rebuild.log') }
}

function rebuildProject({ projectDir, logPath }, platform, arch) {
  return runRebuildScript(projectDir, { ORCA_REBUILD_TEST_LOG: logPath }, [
    `--platform=${platform}`,
    `--arch=${arch}`,
    '--force'
  ])
}

describe('node-pty macOS exception preparation', () => {
  it.each(['x64', 'arm64'])(
    'prepares a late exception override before rebuilding macOS %s, idempotently',
    (arch) => {
      const project = prepareProject('darwin')
      try {
        const first = rebuildProject(project, 'darwin', arch)
        expect(first.status, first.stderr).toBe(0)
        const [rebuilt] = readFileSync(project.logPath, 'utf8').trim().split('\n').map(JSON.parse)
        expect(rebuilt).toMatchObject({
          platform: 'darwin',
          arch,
          onlyModules: ['node-pty'],
          ignoreModules: ['cpu-features']
        })
        expect(rebuilt.nodePtyBindingGyp).toMatch(
          /'target_conditions':\s*\[\s*\['OS=="mac"',\s*\{\s*'xcode_settings':\s*\{\s*'GCC_ENABLE_CPP_EXCEPTIONS': 'YES'/
        )
        expect(rebuilt.nodePtyBindingGyp).toContain("'CLANG_CXX_LIBRARY': 'libc++'")
        expect(rebuilt.nodePtyBindingGyp).toContain("'MACOSX_DEPLOYMENT_TARGET': '10.7'")
        expect(rebuilt.nodePtyBindingGyp).toContain("'cflags_cc': [ '-std=gnu++2a' ]")
        const prepared = readFileSync(project.bindingPath, 'utf8')
        const second = rebuildProject(project, 'darwin', arch)
        expect(second.status, second.stderr).toBe(0)
        expect(readFileSync(project.bindingPath, 'utf8')).toBe(prepared)
        expect(second.stderr).not.toContain('Prepared node-pty macOS exception settings')
      } finally {
        removeTreeSync(project.projectDir)
      }
    }
  )

  it.each(['linux', 'win32'])('leaves node-pty gyp bytes unchanged for %s', (platform) => {
    const project = prepareProject(platform)
    try {
      if (platform === 'win32') {
        writeFakeNodePtyConptySource(project.projectDir)
        writeFakeNodePtyConptyPayload(project.projectDir, process.arch)
      }
      const result = rebuildProject(project, platform, process.arch)
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(project.bindingPath, 'utf8')).toBe(patchedBindingGyp)
    } finally {
      removeTreeSync(project.projectDir)
    }
  })

  it.each([
    ['missing target defaults', "{ 'targets': [] }"],
    [
      'existing unrecognised late conditions',
      patchedBindingGyp.replace(
        "'target_defaults': {",
        "'target_defaults': { 'target_conditions': [],"
      )
    ]
  ])('rejects %s before compiling instead of creating ambiguous gyp keys', (_, bindingGyp) => {
    const project = prepareProject('darwin', bindingGyp)
    try {
      const result = rebuildProject(project, 'darwin', 'arm64')
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('Unsupported node-pty binding.gyp layout')
      expect(existsSync(project.logPath)).toBe(false)
      expect(readFileSync(project.bindingPath, 'utf8')).toBe(bindingGyp)
    } finally {
      removeTreeSync(project.projectDir)
    }
  })
})
