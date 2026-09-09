import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
const toolchain = JSON.parse(readFileSync(join(projectDir, 'config/toolchain.json'), 'utf8'))
const nodeBookwormImage =
  `node:${toolchain.node}-bookworm@sha256:` +
  '4e9cb555d708e0829c9d93e5eeae9dfab0617b832ca436a690680e0fca735ef5'

describe('shared build toolchain contract', () => {
  it('keeps package metadata and local Node pin aligned', () => {
    expect(packageJson.engines.node).toBe(toolchain.node)
    expect(packageJson.packageManager).toMatch(new RegExp(`^pnpm@${toolchain.pnpm}\\+`))
    expect(packageJson.engines.node).toBe(toolchain.node)
    expect(packageJson.packageManager.split('+')[0]).toBe(`pnpm@${toolchain.pnpm}`)
    expect(packageJson.devDependencies.electron).toBe(toolchain.electron)
    expect(packageJson.devDependencies.vitest.replace(/^\^/, '')).toBe(toolchain.vitest)
  })

  it('routes local clients through one coordinator', () => {
    expect(packageJson.scripts['clients:build']).toBe(
      'node --use-env-proxy config/scripts/client-build.mjs build'
    )
    for (const name of ['build:win', 'build:linux', 'build:mac']) {
      expect(packageJson.scripts[name]).toContain('clients:build')
    }
  })

  it('keeps Node-based build containers on the shared immutable baseline', () => {
    const dockerfiles = [
      'config/docker/headless-pairing/Dockerfile.build',
      'tests/e2e/fixtures/docker-ssh-relay/Dockerfile'
    ]

    for (const relativePath of dockerfiles) {
      const firstLine = readFileSync(join(projectDir, relativePath), 'utf8').split(/\r?\n/, 1)[0]
      expect(firstLine, relativePath).toBe(`FROM ${nodeBookwormImage}`)
    }
  })
})
