import { chmod, copyFile, cp, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import productPackage from '../../package.json'

export async function produceNativePi(projectRoot: string) {
  if (process.versions.node !== productPackage.engines.node) {
    throw new Error('Native Pi requires the pinned build Node runtime')
  }
  const source = join(projectRoot, 'runtime', 'native-pi')
  const output = join(projectRoot, 'out', 'native-pi', `${process.platform}-${process.arch}`)
  const installed = JSON.parse(
    await readFile(
      join(source, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'),
      'utf8'
    )
  )
  if (installed.version !== '0.85.1') {
    throw new Error('Native Pi version does not match its pin')
  }
  await mkdir(output, { recursive: true })
  await cp(join(source, 'node_modules'), join(output, 'node_modules'), {
    recursive: true,
    dereference: true
  })
  for (const name of [
    'launcher.mjs',
    'hive-provider.mjs',
    'model-preference.mjs',
    'package.json',
    'pnpm-lock.yaml'
  ]) {
    await copyFile(join(source, name), join(output, name))
  }
  const node = join(output, process.platform === 'win32' ? 'node.exe' : 'node')
  await copyFile(process.execPath, node)
  if (process.platform !== 'win32') {
    await chmod(node, 0o755)
  }
  return output
}

export function createNativePiBuildPlugin(projectRoot: string): Plugin {
  return {
    name: 'hive-native-pi-build',
    async config() {
      await produceNativePi(projectRoot)
    }
  }
}
