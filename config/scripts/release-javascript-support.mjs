import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDirectInvocation } from './script-entry-detection.mjs'

export function releaseJavascriptSupport(root = process.cwd()) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (!pkg.scripts?.['build:release:javascript'] || !pkg.scripts?.['build:release:host']) {
    return { supported: false, reason: 'This source has no shared JavaScript build commands.' }
  }
  return { supported: true, reason: '' }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  const support = releaseJavascriptSupport()
  console.log(`supported=${support.supported}`)
  console.log(`reason=${support.reason}`)
}
