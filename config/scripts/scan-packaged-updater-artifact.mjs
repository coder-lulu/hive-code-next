#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  verifyPackagedUpdaterSecurityBoundary
} = require('../packaged-updater-security-boundary.cjs')

function parseArgs(argv) {
  const args = { resources: null, output: null }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--resources') {
      args.resources = argv[++index] ?? null
    } else if (value === '--output') {
      args.output = argv[++index] ?? null
    } else {
      throw new Error(`Unknown argument: ${value}`)
    }
  }
  if (!args.resources) {
    throw new Error(
      'Usage: scan-packaged-updater-artifact.mjs --resources <resources-dir> [--output <json>]'
    )
  }
  return args
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function findPackagedExecutable(resourcesDir) {
  const appRoot = dirname(resourcesDir)
  const candidates = readdirSync(appRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.exe$/i.test(entry.name) &&
        !/^(?:unins|uninstall|squirrel)/i.test(entry.name)
    )
    .map((entry) => join(appRoot, entry.name))
    .sort()
  return candidates.length === 1 ? candidates[0] : null
}

const args = parseArgs(process.argv.slice(2))
const resourcesDir = resolve(args.resources)
if (!existsSync(resourcesDir)) {
  throw new Error(`Packaged resources directory does not exist: ${resourcesDir}`)
}

const report = verifyPackagedUpdaterSecurityBoundary(resourcesDir)
const executablePath = findPackagedExecutable(resourcesDir)
const evidence = {
  ...report,
  resourcesDir,
  executable: executablePath
    ? {
        path: relative(dirname(resourcesDir), executablePath).replace(/\\/g, '/'),
        sha256: sha256File(executablePath)
      }
    : null
}
const json = `${JSON.stringify(evidence, null, 2)}\n`

if (args.output) {
  const outputPath = resolve(args.output)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, json, 'utf8')
}
process.stdout.write(json)
