import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { inputFiles, readJson, sha256 } from './client-build-contract.mjs'

// Adopt a previously installed tree only when its graph, layout and patches agree.
export function canReuseInstalledDependencies(context, name) {
  const cwd = name === 'android' ? join(context.root, 'mobile') : context.root
  const modules = join(cwd, 'node_modules/.modules.yaml')
  const virtualLock = join(cwd, 'node_modules/.pnpm/lock.yaml')
  if (!existsSync(modules) || !existsSync(virtualLock)) {
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
    if (JSON.stringify(source) !== JSON.stringify(readLock(virtualLock))) {
      return false
    }
    const metadata = parse(readFileSync(modules, 'utf8'))
    if (
      metadata.nodeLinker !== (name === 'android' ? 'hoisted' : 'isolated') ||
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
