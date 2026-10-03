const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const sharedRoot = path.resolve(projectRoot, '..', 'src', 'shared')
const relayJsonParserRoot = path.dirname(
  require.resolve('jsonc-parser/package.json', { paths: [path.resolve(projectRoot, '..')] })
)

const config = getDefaultConfig(projectRoot)
// Gradle replaces intermediate directories while building. Watching them can
// crash Metro on Windows and adds no JavaScript source to the app.
const blockList = config.resolver.blockList
config.resolver.blockList = [
  ...(Array.isArray(blockList) ? blockList : blockList ? [blockList] : []),
  /[/\\]android[/\\](?:.*[/\\])?(?:build|\.gradle|\.cxx)(?:[/\\]|$)/
]
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

/**
 * The shell kind the bundle is being built for, by the same rule `mobileShellBuildKind` applies in
 * `src/storage/preferences.ts`. This read runs in Node at config time, so it is not the second
 * inlined read that module's census forbids.
 */
const shellBuildKind = process.env.EXPO_PUBLIC_MOBILE_SHELL === 'ota' ? 'ota' : 'native'

// Why: babel-preset-expo inlines EXPO_PUBLIC_MOBILE_SHELL at transform time, but nothing Metro
// hashes into the transform cache key carries that value, so a warm cache from the opposite kind
// silently bakes the wrong shell into a release.
config.cacheVersion = `${config.cacheVersion}-shell-${shellBuildKind}`

module.exports = config
