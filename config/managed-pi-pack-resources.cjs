const { join, resolve } = require('node:path')

function createManagedPiPackResource(platform) {
  if (!['win32', 'darwin', 'linux'].includes(platform)) {
    throw new Error('Unsupported Pack platform')
  }
  return {
    from: `out/managed-pi/${platform}-${'${arch}'}`,
    to: `managed-pi/${platform}-${'${arch}'}`,
    filter: [
      'pack-index.json',
      platform === 'win32' ? 'node.exe' : 'node',
      'agent.cjs',
      'package.json',
      'pnpm-lock.yaml',
      'sbom.json',
      'LICENSE',
      'NOTICE'
    ]
  }
}

// Preserve the build input's bytes/signature; signing again would invalidate compiled trust.
const managedPiWindowsSignExts = ['x64', 'arm64'].flatMap((arch) =>
  ['/', '\\'].map((separator) => `!${['managed-pi', `win32-${arch}`, 'node.exe'].join(separator)}`)
)
const managedPiMacSignIgnore = ['(?:^|/)managed-pi/darwin-(?:x64|arm64)/node$']

async function verifyPackagedManagedPiTextPack(context, projectRoot) {
  const architecture = { 1: 'x64', 3: 'arm64' }[context.arch]
  if (!architecture) {
    throw new Error('Unsupported packaged Pack architecture')
  }
  const product = require(join(projectRoot, 'out', 'main', 'managed-pi-pack-product.js'))
  product.getProductManagedPiPackIdentity(context.electronPlatformName, architecture)
  if (context.electronPlatformName !== process.platform || architecture !== process.arch) {
    throw new Error('Pack packaging requires a verified build for the target platform/architecture')
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
  const pack = await product.loadProductManagedPiTextPack(resolve(resources))
  try {
    pack.readPack()
  } finally {
    pack.dispose()
  }
}

module.exports = {
  createManagedPiPackResource,
  managedPiWindowsSignExts,
  managedPiMacSignIgnore,
  verifyPackagedManagedPiTextPack
}
