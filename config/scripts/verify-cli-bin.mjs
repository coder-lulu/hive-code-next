#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Electron packaging restamps the channel-specific version after compilation.
function buildOutPackageJson(version) {
  return `${JSON.stringify(
    { name: 'orca-compiled-output', type: 'commonjs', private: true, version },
    null,
    2
  )}\n`
}
const PLATFORM_RESERVED_COMMAND_NAMES = new Set(['orca'])
const DEFAULT_CLI_COMMAND_NAMES = ['hive', 'hivecode', 'orca-ide']

function resolveCliCommandNames(projectDir) {
  const manifestPath = path.join(projectDir, 'config', 'product', 'hivecode.product.json')
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const commandNames = [manifest.cli?.primary, ...(manifest.cli?.aliases ?? [])]
      .filter(Boolean)
      .filter((commandName) => !PLATFORM_RESERVED_COMMAND_NAMES.has(commandName))
    if (
      commandNames.length === 0 ||
      commandNames.some(
        (commandName) => typeof commandName !== 'string' || commandName.length === 0
      )
    ) {
      throw new Error(`Invalid CLI command contract in ${path.relative(projectDir, manifestPath)}`)
    }
    const deduped = [...new Set(commandNames)]
    if (deduped.length !== commandNames.length) {
      throw new Error(`CLI command names must not contain duplicates: ${commandNames.join(', ')}`)
    }
    if (deduped.length < 2) {
      throw new Error(
        `CLI package contract must declare a primary command and at least one globally safe alias, got: ${deduped.join(', ')}`
      )
    }
    return deduped
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return DEFAULT_CLI_COMMAND_NAMES
    }
    throw error
  }
}

/**
 * Verifies the published CLI entrypoint and the module-type boundary for the
 * compiled output tree that the packaged CLI loads at runtime.
 */
export function verifyPackageCliBin({
  projectDir = path.resolve(import.meta.dirname, '..', '..'),
  fixExecutable = false,
  fixPackageJson = false,
  runHelp = false
} = {}) {
  const packageJsonPath = path.join(projectDir, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  if (Object.hasOwn(packageJson.bin ?? {}, 'orca')) {
    throw new Error('package.json must not declare bin.orca because it conflicts with GNOME Orca')
  }
  const commandNames = resolveCliCommandNames(projectDir)
  const primaryCommandName = commandNames[0]
  const binTargets = commandNames.map((commandName) => {
    const target = packageJson.bin?.[commandName]
    if (typeof target !== 'string' || target.length === 0) {
      throw new Error(`package.json must declare bin.${commandName}`)
    }
    return target
  })
  if (new Set(binTargets).size !== 1) {
    throw new Error(`CLI commands ${commandNames.join(', ')} must point to the same target`)
  }
  const binTarget = binTargets[0]

  const binPath = path.resolve(projectDir, binTarget)
  const stats = statSync(binPath)
  if (!stats.isFile()) {
    throw new Error(`bin.${primaryCommandName} target is not a file: ${binTarget}`)
  }
  if (stats.size === 0) {
    throw new Error(`bin.${primaryCommandName} target is empty: ${binTarget}`)
  }

  const content = readFileSync(binPath, 'utf8')
  if (!content.startsWith('#!/usr/bin/env node\n')) {
    throw new Error(`bin.${primaryCommandName} target must start with a Node shebang: ${binTarget}`)
  }

  const outPackageJsonPath = path.join(projectDir, 'out', 'package.json')
  if (fixPackageJson) {
    mkdirSync(path.dirname(outPackageJsonPath), { recursive: true })
    writeFileSync(outPackageJsonPath, buildOutPackageJson(packageJson.version), 'utf8')
  }
  let outPackageJson
  try {
    outPackageJson = JSON.parse(readFileSync(outPackageJsonPath, 'utf8'))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `compiled CLI package boundary is missing: ${path.relative(projectDir, outPackageJsonPath)}`
      )
    }
    throw error
  }
  if (outPackageJson.type !== 'commonjs') {
    throw new Error(
      `compiled CLI package boundary must declare type=commonjs: ${path.relative(
        projectDir,
        outPackageJsonPath
      )}`
    )
  }

  if (process.platform !== 'win32' && (stats.mode & 0o111) === 0) {
    if (!fixExecutable) {
      throw new Error(`bin.${primaryCommandName} target is not executable: ${binTarget}`)
    }
    chmodSync(binPath, stats.mode | 0o755)
  }

  if (runHelp) {
    execFileSync(process.execPath, [binPath, '--help'], {
      cwd: projectDir,
      stdio: 'ignore'
    })
  }

  return { binPath, commandNames, outPackageJsonPath, size: statSync(binPath).size }
}

/** Runs CLI verification from npm scripts and local release checks. */
function main() {
  const args = new Set(process.argv.slice(2))
  const result = verifyPackageCliBin({
    fixExecutable: args.has('--fix-executable'),
    fixPackageJson: args.has('--fix-package-json'),
    runHelp: args.has('--run-help')
  })
  console.log(
    `[cli-bin] verified ${path.relative(process.cwd(), result.binPath)} (${result.size} bytes)`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
