import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** @param {{ projectDir: string, rebuildPlatform: string, modulesToRebuild: string[] }} options */
export function prepareNodePtyMacosExceptions({ projectDir, rebuildPlatform, modulesToRebuild }) {
  if (rebuildPlatform !== 'darwin' || !modulesToRebuild.includes('node-pty')) {
    return
  }
  const bindingPath = resolve(projectDir, 'node_modules', 'node-pty', 'binding.gyp')
  if (!existsSync(bindingPath)) {
    return
  }
  const bindingGyp = readFileSync(bindingPath, 'utf8')
  // Electron common.gypi overrides early conditions; apply exceptions after target defaults.
  const lateExceptionSettings = `
    'target_conditions': [
      ['OS=="mac"', {
        'xcode_settings': { 'GCC_ENABLE_CPP_EXCEPTIONS': 'YES' },
      }],
    ],`
  if (bindingGyp.includes(lateExceptionSettings)) {
    return
  }
  const targetDefaults = /(['"]target_defaults['"]\s*:\s*\{)/
  if (!targetDefaults.test(bindingGyp) || /['"]target_conditions['"]\s*:/.test(bindingGyp)) {
    throw new Error('Unsupported node-pty binding.gyp layout for macOS exception settings.')
  }
  writeFileSync(bindingPath, bindingGyp.replace(targetDefaults, `$1${lateExceptionSettings}`))
  console.warn('[rebuild] Prepared node-pty macOS exception settings after Electron defaults.')
}
