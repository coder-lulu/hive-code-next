const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const sharedRoot = path.resolve(projectRoot, '..', 'src', 'shared')
const relayJsonParserRoot = path.dirname(
  require.resolve('jsonc-parser/package.json', { paths: [path.resolve(projectRoot, '..')] })
)

const config = getDefaultConfig(projectRoot)
const defaultResolveRequest = config.resolver.resolveRequest
// The UMD entry shadows require inside its factory, so Metro cannot collect its
// relative dependencies. Use this package's static ESM entry without changing others.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target =
    moduleName === 'jsonc-parser' ? path.join(relayJsonParserRoot, 'lib/esm/main.js') : moduleName
  return (defaultResolveRequest ?? context.resolveRequest)(context, target, platform)
}
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'jsonc-parser': relayJsonParserRoot
}

// Why: mobile source-control prompts use the same pure builders as desktop.
// Metro only watches mobile/ by default, so make repo-root shared modules visible.
config.watchFolders = Array.from(
  new Set([...(config.watchFolders ?? []), sharedRoot, relayJsonParserRoot])
)

module.exports = config
