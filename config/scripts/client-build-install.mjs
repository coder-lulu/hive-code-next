import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { inputFiles, readJson, sha256 } from './client-build-contract.mjs'

export function hasBuildToolEntrypoints(cwd, specifiers) {
  const require = createRequire(join(cwd, 'package.json'))
  try {
    for (const specifier of specifiers) {
      require.resolve(specifier)
    }
    return true
  } catch {
    return false
  }
}

function matchesInstalledLockfile(source, installed) {
  if (!source.snapshots || !installed.snapshots) {
    return isDeepStrictEqual(source, installed)
  }
  const referenced = new Set()
  for (const owner of [
    ...Object.values(source.importers || {}),
    ...Object.values(source.snapshots)
  ]) {
    for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, resolution] of Object.entries(owner[kind] || {})) {
        const version = typeof resolution === 'string' ? resolution : resolution.version
        referenced.add(Object.hasOwn(source.snapshots, version) ? version : `${name}@${version}`)
      }
    }
  }
  // pnpm prunes unreferenced snapshots from its installed lock without rewriting
  // the frozen source lock. Keep every referenced snapshot and all other fields.
  const snapshots = { ...source.snapshots }
  for (const key of Object.keys(snapshots)) {
    if (!Object.hasOwn(installed.snapshots, key) && !referenced.has(key)) {
      delete snapshots[key]
    }
  }
  return isDeepStrictEqual({ ...source, snapshots }, installed)
}

// Adopt a previously installed tree only when its graph, layout and patches agree.
export function canReuseInstalledDependencies(context, name) {
  const mobile = name === 'android' || name === 'ios'
  const cwd = mobile ? join(context.root, 'mobile') : context.root
  const modules = join(cwd, 'node_modules/.modules.yaml')
  const virtualLock = join(cwd, 'node_modules/.pnpm/lock.yaml')
  if (!existsSync(modules) || !existsSync(virtualLock)) {
    return false
  }
  if (mobile && !hasBuildToolEntrypoints(cwd, ['@expo/cli', '@expo/prebuild-config', 'uuid'])) {
    return false
  }
  try {
    const require = createRequire(join(cwd, 'package.json'))
    const { parseAllDocuments, parse } = require('yaml')
    const readLock = (file) => {
      const docs = parseAllDocuments(readFileSync(file, 'utf8'))
      if (docs.some((doc) => doc.errors.length)) {
        throw new Error('Invalid lockfile')
      }
      return docs.at(-1).toJSON()
    }
    const source = readLock(join(cwd, 'pnpm-lock.yaml'))
    if (!matchesInstalledLockfile(source, readLock(virtualLock))) {
      return false
    }
    const metadata = parse(readFileSync(modules, 'utf8'))
    if (
      metadata.nodeLinker !== (mobile ? 'hoisted' : 'isolated') ||
      metadata.packageManager !== `pnpm@${context.toolchain.pnpm}`
    ) {
      return false
    }
    const pkg = readJson(join(cwd, 'package.json'))
    for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [dependency, specifier] of Object.entries(pkg[kind] || {})) {
        if (source.importers['.'][kind]?.[dependency]?.specifier !== specifier) {
          return false
        }
        if (kind !== 'optionalDependencies' && !existsSync(join(cwd, 'node_modules', dependency))) {
          return false
        }
        if (specifier.startsWith('file:')) {
          const sourceDirectory = resolve(cwd, specifier.slice(5))
          for (const file of inputFiles(sourceDirectory)) {
            const installed = join(cwd, 'node_modules', dependency, relative(sourceDirectory, file))
            if (
              !existsSync(installed) ||
              sha256(readFileSync(file)) !== sha256(readFileSync(installed))
            ) {
              return false
            }
          }
        }
      }
    }
    const workspace = parse(readFileSync(join(cwd, 'pnpm-workspace.yaml'), 'utf8'))
    const patches = { ...pkg.pnpm?.patchedDependencies, ...workspace.patchedDependencies }
    for (const [dependency, patch] of Object.entries(patches)) {
      if (
        sha256(readFileSync(resolve(cwd, patch), 'utf8').replaceAll('\r\n', '\n')) !==
        source.patchedDependencies?.[dependency]
      ) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}
