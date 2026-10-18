import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveOrcadWebClientRoot } from './orcad-web-client-root'

it('serves installed Web assets and leaves bare SSH slots unavailable', () => {
  const logs = resolve('logs/runtime-archive-tests')
  mkdirSync(logs, { recursive: true })
  const root = mkdtempSync(join(logs, 'web-'))
  try {
    expect(resolveOrcadWebClientRoot(root)).toBeUndefined()
    mkdirSync(join(root, 'out/web'), { recursive: true })
    expect(resolveOrcadWebClientRoot(root)).toBeUndefined()
    writeFileSync(join(root, 'out/web/web-index.html'), '<html></html>')
    expect(resolveOrcadWebClientRoot(root)).toBe(join(root, 'out/web'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
