import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'

// Client preparation must run before installed packages or compiled workspace exports exist.
export async function loadClientBuildProcessHost() {
  const packageRoot = new URL('../../src/packages/process-host/', import.meta.url)
  const sourceRoot = new URL('src/', packageRoot).href
  const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'))
  const target = manifest.exports?.['.']?.['orca-source']
  if (manifest.name !== '@orca/process-host' || typeof target !== 'string') {
    throw new Error('Client builds require the public @orca/process-host source export')
  }
  const entry = new URL(target, packageRoot).href
  if (!target.startsWith('./src/') || !entry.startsWith(sourceRoot) || !entry.endsWith('.ts')) {
    throw new Error('Invalid @orca/process-host source export')
  }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@orca/process-host' && context.parentURL === import.meta.url) {
        return { url: entry, shortCircuit: true }
      }
      if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
        const url = new URL(
          specifier.endsWith('.ts') ? specifier : `${specifier}.ts`,
          context.parentURL
        )
        if (!url.href.startsWith(sourceRoot)) {
          throw new Error('@orca/process-host source import escapes its package')
        }
        return { url: url.href, shortCircuit: true }
      }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url.startsWith(sourceRoot) && url.endsWith('.ts')) {
        return {
          format: 'module',
          source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), {
            mode: 'transform',
            sourceUrl: url
          }),
          shortCircuit: true
        }
      }
      return nextLoad(url, context)
    }
  })
  try {
    return await import('@orca/process-host')
  } finally {
    hooks.deregister()
  }
}
