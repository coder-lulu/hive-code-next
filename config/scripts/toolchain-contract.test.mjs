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
    for (const [name, target] of [
      ['build:win', 'windows-x64'],
      ['build:linux', 'linux'],
      ['build:mac', 'macos']
    ]) {
      expect(packageJson.scripts[name]).toBe(`pnpm run clients:build -- --target ${target}`)
    }
  })

  it('keeps Node-based build containers on the shared immutable baseline', () => {
    const dockerfiles = ['config/docker/headless-pairing/Dockerfile.build']

    // SSH exercises the Node22 line and preserves upstream October security fix eb9d2f9a06.
    const sshDockerfile = readFileSync(
      join(projectDir, 'tests/e2e/fixtures/docker-ssh-host/Dockerfile'),
      'utf8'
    )
    expect(sshDockerfile.split(/\r?\n/)[0]).toBe(
      'FROM node:22.23.4-bookworm@sha256:2bd396628eceb5c999a6e43731fab69d5fb98b94ba9d9d90b5f64575c5178765 AS patched-node'
    )
    expect(sshDockerfile).toContain(
      'FROM node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37'
    )
    expect(sshDockerfile).toContain(
      'COPY --from=patched-node /usr/local/bin/node /usr/local/bin/node'
    )

    for (const relativePath of dockerfiles) {
      const firstLine = readFileSync(join(projectDir, relativePath), 'utf8').split(/\r?\n/, 1)[0]
      expect(firstLine, relativePath).toBe(`FROM ${nodeBookwormImage}`)
    }
  })
})
