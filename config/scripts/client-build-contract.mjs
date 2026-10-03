import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const targets = Object.freeze({
  'windows-x64': { host: 'win32', arch: 'x64', kind: 'desktop', builder: ['--win', '--x64'] },
  'linux-x64': {
    host: 'linux',
    arch: 'x64',
    kind: 'desktop',
    builder: ['--linux', 'AppImage', 'deb', 'rpm', '--x64']
  },
  'linux-arm64': {
    host: 'linux',
    arch: 'arm64',
    kind: 'desktop',
    builder: ['--linux', 'AppImage', 'deb', 'rpm', '--arm64']
  },
  'macos-x64': {
    host: 'darwin',
    arch: 'x64',
    kind: 'desktop',
    builder: ['--mac', 'dmg', 'zip', '--x64']
  },
  'macos-arm64': {
    host: 'darwin',
    arch: 'arm64',
    kind: 'desktop',
    builder: ['--mac', 'dmg', 'zip', '--arm64']
  },
  android: { hosts: ['win32', 'linux', 'darwin'], kind: 'android' },
  ios: { hosts: ['darwin'], kind: 'ios' }
})

export function selectTargets(value = 'all', platform = process.platform, arch = process.arch) {
  const desktop = `${{ win32: 'windows', linux: 'linux', darwin: 'macos' }[platform]}-${arch}`
  if (['windows', 'linux', 'macos'].includes(value)) {
    value = `${value}-${arch}`
  }
  const names =
    value === 'all'
      ? [desktop, 'android', ...(platform === 'darwin' ? ['ios'] : [])]
      : value === 'desktop'
        ? [desktop]
        : value.split(',')
  for (const name of names) {
    const target = targets[name]
    if (!target) {
      throw new Error(`Unsupported target ${name}. Available: ${Object.keys(targets).join(', ')}`)
    }
    if (
      target.host
        ? target.host !== platform || target.arch !== arch
        : !target.hosts.includes(platform)
    ) {
      throw new Error(`${name} requires its native build host; current host is ${platform}-${arch}`)
    }
  }
  return [...new Set(names)]
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

export function inputFiles(directory) {
  if (!existsSync(directory)) {
    return []
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    if (entry.isFile()) {
      return [file]
    }
    if (
      entry.isDirectory() &&
      !['node_modules', 'build', '.gradle', '.cxx', '.git'].includes(entry.name)
    ) {
      return inputFiles(file)
    }
    return []
  })
}

export function validateVersions(pkg, mobile, app, toolchain) {
  if (pkg.version !== mobile.version || pkg.version !== app.expo.version) {
    throw new Error('Desktop/mobile versions differ')
  }
  if (!/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/.test(pkg.version)) {
    throw new Error('Invalid client version')
  }
  if (
    pkg.engines.node !== toolchain.node ||
    !pkg.packageManager.startsWith(`pnpm@${toolchain.pnpm}+`)
  ) {
    throw new Error('Toolchain metadata differs from package.json')
  }
  if (pkg.devDependencies.electron !== toolchain.electron) {
    throw new Error('Electron toolchain version differs')
  }
  if (!Number.isSafeInteger(app.expo.android.versionCode) || app.expo.android.versionCode < 1) {
    throw new Error('Invalid Android versionCode')
  }
}

export function loadContext(root, environment = process.env) {
  const localPath = join(root, '.client-build.local.json')
  const local = existsSync(localPath) ? readJson(localPath) : {}
  const home = resolve(
    root,
    environment.HIVECODE_BUILD_HOME || local.buildHome || join(homedir(), '.hivecode-build')
  )
  const configuredPath = (value) => {
    if (value && !isAbsolute(value)) {
      throw new Error('Client build machine paths must be absolute')
    }
    return value
  }
  const pkg = readJson(join(root, 'package.json'))
  const mobile = readJson(join(root, 'mobile/package.json'))
  const app = readJson(join(root, 'mobile/app.json'))
  const toolchain = readJson(join(root, 'config/toolchain.json'))
  validateVersions(pkg, mobile, app, toolchain)
  const release = readJson(join(root, 'config/client-build.json'))
  if (!Number.isSafeInteger(release.desktopBuildNumber) || release.desktopBuildNumber < 1) {
    throw new Error('Invalid desktop build number')
  }
  const channel = pkg.version.includes('-beta.')
    ? 'beta'
    : pkg.version.includes('-rc.')
      ? 'rc'
      : 'stable'
  if (release.channel !== channel) {
    throw new Error('Release channel differs from version')
  }
  const env = {
    ...environment,
    ORCA_BACKGROUND_LAUNCH: '1',
    NODE_USE_ENV_PROXY: '1',
    ELECTRON_INSTALL_PLATFORM: process.platform,
    ELECTRON_INSTALL_ARCH: process.arch,
    HIVECODE_BUILD_HOME: home,
    ELECTRON_CACHE: configuredPath(local.electronCache) || join(home, 'cache/electron-downloads'),
    ELECTRON_BUILDER_CACHE:
      configuredPath(local.builderCache) || join(home, 'cache/electron-builder'),
    GRADLE_USER_HOME: configuredPath(local.gradleCache) || join(home, 'cache/gradle'),
    JAVA_HOME: configuredPath(local.javaHome || environment.JAVA_HOME),
    ANDROID_HOME: configuredPath(
      local.androidSdk || environment.ANDROID_HOME || environment.ANDROID_SDK_ROOT
    ),
    ORCA_REUSE_PREPARED_NATIVE_RUNTIME: '1',
    HIVECODE_EMBED_RELEASE_IDENTITY: '1',
    HIVECODE_BUILD_NUMBER: String(release.desktopBuildNumber),
    HIVECODE_RELEASE_CHANNEL: release.channel,
    NODE_OPTIONS: [environment.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' ')
  }
  return {
    root,
    local,
    home,
    pkg,
    app,
    toolchain,
    release,
    env,
    store: configuredPath(local.pnpmStore) || join(home, 'cache/pnpm'),
    work: join(home, 'work', sha256(root).slice(0, 12)),
    output: join(root, 'dist', pkg.version)
  }
}

export function dependencyFingerprint(context, name) {
  const files = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'config/toolchain.json',
    'config/client-build.json'
  ]
  if (['android', 'ios'].includes(name)) {
    files.push(
      'mobile/package.json',
      'mobile/pnpm-lock.yaml',
      'mobile/pnpm-workspace.yaml',
      'mobile/app.json'
    )
  }
  for (const directory of [
    'config/patches',
    ...(['android', 'ios'].includes(name)
      ? ['mobile/patches', 'mobile/plugins', 'mobile/packages', 'mobile/gradle-locks']
      : [])
  ]) {
    if (existsSync(join(context.root, directory))) {
      files.push(...inputFiles(join(context.root, directory)))
    }
  }
  return sha256(
    JSON.stringify({
      target: name,
      host: `${process.platform}-${process.arch}`,
      paths: [
        context.root,
        context.home,
        context.store,
        context.env.GRADLE_USER_HOME,
        context.env.JAVA_HOME,
        context.env.ANDROID_HOME
      ],
      files: files.sort().map((file) => [file, sha256(readFileSync(resolve(context.root, file)))])
    })
  )
}

export function installedResourceFingerprint(context, name) {
  const files =
    name === 'ios'
      ? [
          'mobile/node_modules/.modules.yaml',
          'mobile/node_modules/react-native/package.json',
          'mobile/node_modules/expo/package.json',
          'mobile/ios/Podfile.lock',
          'mobile/ios/HiveCode.xcodeproj/project.pbxproj'
        ]
      : name === 'android'
        ? [
            'mobile/node_modules/.modules.yaml',
            'mobile/node_modules/react-native/package.json',
            'mobile/node_modules/expo/package.json',
            'mobile/android/gradle/wrapper/gradle-wrapper.properties',
            'mobile/android/app/build.gradle'
          ]
        : [
            'node_modules/.modules.yaml',
            'node_modules/electron/package.json',
            'node_modules/electron/dist/version',
            'node_modules/electron-builder/package.json'
          ]
  return sha256(
    JSON.stringify(files.map((file) => [file, sha256(readFileSync(join(context.root, file)))]))
  )
}

export function hasPreparedResources(context, name) {
  try {
    const receipt = readJson(join(context.work, name, 'prepared.json'))
    return (
      receipt.fingerprint === dependencyFingerprint(context, name) &&
      receipt.resources === installedResourceFingerprint(context, name)
    )
  } catch {
    return false
  }
}
