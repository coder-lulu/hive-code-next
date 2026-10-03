const { execFileSync } = require('node:child_process')
const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

function createNativePiResources(platform) {
  const base = {
    from: `out/native-pi/${platform}-\${arch}`,
    to: `native-pi/${platform}-\${arch}`,
    filter: ['**/*', '!node_modules/.bin/**/*', '!node_modules/.modules.yaml']
  }
  const installed = join(__dirname, '..', 'runtime', 'native-pi')
  const resources = [base]
  const collect = (relativeDirectory) => {
    const directory = join(installed, relativeDirectory)
    if (!existsSync(directory)) {
      return
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue
      }
      const relativePackage = join(relativeDirectory, entry.name)
      if (entry.name.startsWith('@')) {
        collect(relativePackage)
        continue
      }
      if (!existsSync(join(installed, relativePackage, 'package.json'))) {
        continue
      }
      // Builder excludes nested node_modules even in extraResources; map each package explicitly.
      resources.push({
        from: `${base.from}/${relativePackage}`,
        to: `${base.to}/${relativePackage}`
      })
      collect(join(relativePackage, 'node_modules'))
    }
  }
  collect('node_modules')
  if (resources.length === 1) {
    throw new Error('Native Pi dependencies are not installed')
  }
  return resources
}

function verifyPackagedNativePi(context) {
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  if (context.electronPlatformName !== process.platform || arch !== process.arch) {
    throw new Error('Native Pi must be packaged and verified on its target architecture')
  }
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources'
        )
      : join(context.appOutDir, 'resources')
  const root = join(resources, 'native-pi', `${process.platform}-${arch}`)
  const version = execFileSync(
    join(root, process.platform === 'win32' ? 'node.exe' : 'node'),
    [
      '--import',
      pathToFileURL(join(root, 'launcher.mjs')).href,
      join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
      '--version'
    ],
    { encoding: 'utf8', timeout: 30000, windowsHide: true }
  )
  if (version.trim() !== '0.85.1') {
    throw new Error('Packaged native Pi did not boot its pinned CLI')
  }
}

module.exports = { createNativePiResources, verifyPackagedNativePi }
