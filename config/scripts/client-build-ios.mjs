import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { capture, nodeStep, pnpmStep, step } from './client-build-execution.mjs'
import { sha256 } from './client-build-contract.mjs'

const scheme = 'HiveCode'
const verificationName = 'ios-build-verification.json'
const unsignedSignature = { status: 'unsigned' }
const linkerAdhocSignature = {
  status: 'linker-adhoc',
  flags: '0x20002',
  authority: false,
  teamIdentifier: null,
  verified: true
}

export function iosVersionIdentity(context) {
  const releaseVersion = context.pkg.version
  const match = /^(\d+\.\d+\.\d+)(?:-(?:beta|rc)\.\d+)?$/.exec(releaseVersion)
  const { bundleIdentifier, buildNumber } = context.app.expo.ios
  if (!match || context.app.expo.version !== releaseVersion) {
    throw new Error('Invalid or inconsistent iOS release version')
  }
  if (
    !/^[1-9]\d*$/.test(buildNumber) ||
    !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleIdentifier)
  ) {
    throw new Error('Invalid iOS bundle identifier or build number')
  }
  return { releaseVersion, marketingVersion: match[1], buildNumber, bundleIdentifier }
}

function artifactNames(context) {
  return {
    archive: `HiveCode-iOS-${context.pkg.version}-unsigned-archive.tar.gz`,
    simulator: `HiveCode-iOS-${context.pkg.version}-simulator.tar.gz`
  }
}

export async function iosPreflight(context) {
  if (process.platform !== 'darwin') {
    throw new Error('iOS requires a macOS host with the pinned Xcode and CocoaPods')
  }
  iosVersionIdentity(context)
  const pin = context.release.ios?.xcode
  if (!pin || !/^\d+\.\d+(?:\.\d+)?$/.test(pin)) {
    throw new Error('Configure the pinned iOS Xcode version in config/client-build.json')
  }
  const xcode = await capture(context, 'xcodebuild', ['-version'])
  if (xcode.match(/^Xcode (\S+)$/m)?.[1] !== pin) {
    throw new Error(`iOS requires Xcode ${pin}; selected toolchain differs`)
  }
  const sdkPaths = {}
  for (const sdk of ['iphoneos', 'iphonesimulator']) {
    sdkPaths[sdk] = await capture(context, 'xcrun', ['--sdk', sdk, '--show-sdk-path'])
    if (!existsSync(sdkPaths[sdk])) {
      throw new Error(`Xcode ${pin} is missing the ${sdk} SDK`)
    }
  }
  return {
    xcode,
    sdkPaths,
    ruby: await capture(context, 'ruby', ['--version']),
    cocoaPods: await capture(context, 'pod', ['--version'])
  }
}

async function plist(context, file) {
  return JSON.parse(
    await capture(context, '/usr/bin/plutil', ['-convert', 'json', '-o', '-', file])
  )
}

export async function verifyIOSExecutableSignature(context, binary, platform) {
  if (!['iphoneos', 'iphonesimulator'].includes(platform)) {
    throw new Error('Invalid iOS executable platform')
  }
  let display
  try {
    display = await capture(context, '/usr/bin/codesign', ['--display', '--verbose=4', binary])
  } catch (error) {
    if (!error.message.includes('code object is not signed at all')) {
      throw error
    }
    display = error.message
    mkdirSync(context.logs, { recursive: true })
    writeFileSync(join(context.logs, `ios-signature-${platform}.log`), `${display}\n`)
    return { ...unsignedSignature }
  }
  mkdirSync(context.logs, { recursive: true })
  writeFileSync(join(context.logs, `ios-signature-${platform}.log`), `${display}\n`)
  if (platform === 'iphoneos') {
    throw new Error('iOS validation application is signed; an unsigned device archive was required')
  }
  const flags = [...display.matchAll(/^CodeDirectory .*\bflags=(0x[\da-f]+)\(/gm)].map(
    (match) => match[1]
  )
  const signatures = [...display.matchAll(/^Signature=([^\r\n]*)\r?$/gm)].map((match) => match[1])
  const teams = [...display.matchAll(/^TeamIdentifier=([^\r\n]*)\r?$/gm)].map((match) => match[1])
  if (
    JSON.stringify(flags) !== JSON.stringify([linkerAdhocSignature.flags]) ||
    JSON.stringify(signatures) !== JSON.stringify(['adhoc']) ||
    JSON.stringify(teams) !== JSON.stringify(['not set']) ||
    /^Authority=/m.test(display)
  ) {
    throw new Error('iOS simulator signature is not linker ad hoc without certificate or team')
  }
  // Security treats an app's executable path as its bundle; isolate the unchanged Mach-O bytes.
  const bytes = readFileSync(binary)
  const binarySha256 = sha256(bytes)
  const proof = { scope: 'standalone-mach-o', binarySha256, verified: false }
  const proofFile = join(context.logs, `ios-signature-${platform}-verification.json`)
  writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`)
  const directory = mkdtempSync(join(context.logs, `ios-${platform}-mach-o-`))
  try {
    const snapshot = join(directory, basename(binary))
    writeFileSync(snapshot, bytes, { flag: 'wx', mode: statSync(binary).mode & 0o777 })
    if (sha256(readFileSync(snapshot)) !== binarySha256) {
      throw new Error('iOS executable bytes changed before signature verification')
    }
    await capture(context, '/usr/bin/codesign', ['--verify', '--strict', snapshot])
    if (
      sha256(readFileSync(binary)) !== binarySha256 ||
      sha256(readFileSync(snapshot)) !== binarySha256
    ) {
      throw new Error('iOS executable bytes changed during signature verification')
    }
    proof.verified = true
    writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  return { ...linkerAdhocSignature, flags: flags[0] }
}

async function verifyApp(context, app, platform, architectures) {
  const identity = iosVersionIdentity(context)
  const metadata = await plist(context, join(app, 'Info.plist'))
  if (
    metadata.CFBundleIdentifier !== identity.bundleIdentifier ||
    metadata.CFBundleShortVersionString !== identity.marketingVersion ||
    metadata.CFBundleVersion !== identity.buildNumber ||
    metadata.CFBundlePackageType !== 'APPL' ||
    metadata.DTPlatformName !== platform ||
    JSON.stringify(metadata.CFBundleSupportedPlatforms) !==
      JSON.stringify([platform === 'iphoneos' ? 'iPhoneOS' : 'iPhoneSimulator'])
  ) {
    throw new Error(`iOS ${platform} app identity or platform validation failed`)
  }
  const executable = metadata.CFBundleExecutable
  if (
    !executable ||
    basename(executable) !== executable ||
    !statSync(join(app, executable)).isFile()
  ) {
    throw new Error('iOS application executable is missing or invalid')
  }
  for (const file of ['_CodeSignature', 'embedded.mobileprovision']) {
    if (existsSync(join(app, file))) {
      throw new Error('iOS validation build unexpectedly contains signing or provisioning material')
    }
  }
  const binary = join(app, executable)
  const signature = await verifyIOSExecutableSignature(context, binary, platform)
  const actualArchitectures = (await capture(context, 'xcrun', ['lipo', '-archs', binary])).split(
    /\s+/
  )
  if (JSON.stringify(actualArchitectures.sort()) !== JSON.stringify([...architectures].sort())) {
    throw new Error('iOS Mach-O architecture coverage differs')
  }
  const loadCommands = await capture(context, 'xcrun', ['vtool', '-show-build', binary])
  const platforms = [...loadCommands.matchAll(/^\s*platform\s+(\S+)\s*$/gm)].map(
    (match) => match[1]
  )
  const expected = platform === 'iphoneos' ? 'IOS' : 'IOSSIMULATOR'
  if (platforms.length !== architectures.length || platforms.some((value) => value !== expected)) {
    throw new Error('iOS Mach-O platform differs from the requested device or simulator build')
  }
  return {
    platform,
    architectures,
    executable,
    unsigned: signature.status === 'unsigned',
    provisioned: false,
    signature
  }
}

async function verifyTar(context, file, root, executable, archive) {
  if (!statSync(file).isFile() || statSync(file).size === 0) {
    throw new Error('iOS artifact archive is empty or missing')
  }
  const entries = (await capture(context, '/usr/bin/tar', ['-tzf', file])).split(/\r?\n/)
  if (entries.some((entry) => !entry.startsWith(`${root}/`) || entry.split('/').includes('..'))) {
    throw new Error('iOS artifact archive contains an unexpected or unsafe path')
  }
  const app = archive ? `${root}/Products/Applications/${scheme}.app` : root
  for (const required of [
    `${app}/Info.plist`,
    `${app}/${executable}`,
    ...(archive ? [`${root}/Info.plist`] : [])
  ]) {
    if (!entries.includes(required)) {
      throw new Error(`iOS artifact archive is missing ${required}`)
    }
  }
}

export async function buildIOS(context, online) {
  const toolchain = await iosPreflight(context)
  const identity = iosVersionIdentity(context)
  const mobile = join(context.root, 'mobile')
  const native = join(mobile, 'ios')
  const workspace = join(native, `${scheme}.xcworkspace`)
  const work = join(context.work, 'ios', context.attempt)
  const output = join(work, 'package')
  mkdirSync(output, { recursive: true })
  await pnpmStep(context, 'ios-typecheck', ['run', 'typecheck'], mobile)
  await pnpmStep(context, 'ios-webview-assets', ['run', 'postinstall'], mobile)
  if (online) {
    await nodeStep(
      context,
      'ios-prebuild',
      join(mobile, 'node_modules/expo/bin/cli'),
      ['prebuild', '--platform', 'ios', '--no-install'],
      mobile
    )
    await step(context, 'ios-pods', 'pod', ['install'], native)
  }
  for (const file of [
    workspace,
    join(native, 'Podfile.lock'),
    join(native, 'Pods/Manifest.lock')
  ]) {
    if (!existsSync(file)) {
      throw new Error(
        'Generated iOS workspace or CocoaPods dependencies are missing; run clients:prepare'
      )
    }
  }
  if (
    readFileSync(join(native, 'Podfile.lock'), 'utf8') !==
    readFileSync(join(native, 'Pods/Manifest.lock'), 'utf8')
  ) {
    throw new Error('Installed iOS CocoaPods dependencies differ from Podfile.lock')
  }
  // Expo writes a literal marketing version; keep the tracked release identity intact.
  await step(context, 'ios-marketing-version', '/usr/bin/plutil', [
    '-replace',
    'CFBundleShortVersionString',
    '-string',
    identity.marketingVersion,
    join(native, scheme, 'Info.plist')
  ])
  const settings = [
    '-workspace',
    workspace,
    '-scheme',
    scheme,
    '-configuration',
    'Release',
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
    `MARKETING_VERSION=${identity.marketingVersion}`,
    `CURRENT_PROJECT_VERSION=${identity.buildNumber}`,
    'ONLY_ACTIVE_ARCH=NO'
  ]
  const archive = join(work, `${scheme}.xcarchive`)
  await step(
    context,
    'ios-unsigned-archive',
    'xcodebuild',
    [
      ...settings,
      '-sdk',
      'iphoneos',
      '-destination',
      'generic/platform=iOS',
      '-derivedDataPath',
      join(work, 'device-derived-data'),
      '-archivePath',
      archive,
      'ARCHS=arm64',
      'archive'
    ],
    mobile
  )
  const simulatorArchitectures = [process.arch === 'arm64' ? 'arm64' : 'x86_64']
  const simulatorData = join(work, 'simulator-derived-data')
  await step(
    context,
    'ios-simulator-release',
    'xcodebuild',
    [
      ...settings,
      '-sdk',
      'iphonesimulator',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      simulatorData,
      `ARCHS=${simulatorArchitectures[0]}`,
      'build'
    ],
    mobile
  )
  const simulator = join(simulatorData, 'Build/Products/Release-iphonesimulator', `${scheme}.app`)
  const applications = readdirSync(join(archive, 'Products/Applications')).filter((file) =>
    file.endsWith('.app')
  )
  if (JSON.stringify(applications) !== JSON.stringify([`${scheme}.app`])) {
    throw new Error('iOS archive does not contain exactly the HiveCode application')
  }
  const applicationPath = await capture(context, '/usr/bin/plutil', [
    '-extract',
    'ApplicationProperties.ApplicationPath',
    'raw',
    '-expect',
    'string',
    '-o',
    '-',
    join(archive, 'Info.plist')
  ])
  if (applicationPath !== `Applications/${scheme}.app`) {
    throw new Error('iOS xcarchive application path differs')
  }
  const builds = {
    archive: await verifyApp(
      context,
      join(archive, 'Products/Applications', `${scheme}.app`),
      'iphoneos',
      ['arm64']
    ),
    simulator: await verifyApp(context, simulator, 'iphonesimulator', simulatorArchitectures)
  }
  const files = []
  const names = artifactNames(context)
  for (const [kind, source] of [
    ['archive', archive],
    ['simulator', simulator]
  ]) {
    const file = join(output, names[kind])
    await step(
      { ...context, env: { ...context.env, COPYFILE_DISABLE: '1' } },
      `ios-package-${kind}`,
      '/usr/bin/tar',
      ['-czf', file, '-C', dirname(source), basename(source)]
    )
    await verifyTar(context, file, basename(source), builds[kind].executable, kind === 'archive')
    files.push({ kind, name: names[kind], sha256: sha256(readFileSync(file)) })
  }
  writeFileSync(
    join(output, verificationName),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        target: 'ios',
        identity,
        source: context.source,
        toolchain,
        deviceInstallable: false,
        ipaProduced: false,
        builds,
        files
      },
      null,
      2
    )}\n`
  )
  return output
}

export async function verifyIOSArtifacts(context, source) {
  const receipt = JSON.parse(readFileSync(join(source, verificationName), 'utf8'))
  const names = artifactNames(context)
  if (
    receipt.schemaVersion !== 1 ||
    receipt.target !== 'ios' ||
    JSON.stringify(receipt.identity) !== JSON.stringify(iosVersionIdentity(context)) ||
    JSON.stringify(receipt.source) !== JSON.stringify(context.source) ||
    receipt.deviceInstallable !== false ||
    receipt.ipaProduced !== false ||
    receipt.toolchain?.xcode?.match(/^Xcode (\S+)$/m)?.[1] !== context.release.ios?.xcode ||
    receipt.files?.length !== 2 ||
    JSON.stringify(readdirSync(source).sort()) !==
      JSON.stringify([...Object.values(names), verificationName].sort())
  ) {
    throw new Error('iOS artifact identity, source or validation contract differs')
  }
  const files = []
  for (const [kind, name] of Object.entries(names)) {
    const build = receipt.builds?.[kind]
    const expectedArchitectures = [
      kind === 'archive' ? 'arm64' : process.arch === 'arm64' ? 'arm64' : 'x86_64'
    ]
    const expectedPlatform = kind === 'archive' ? 'iphoneos' : 'iphonesimulator'
    const file = join(source, name)
    const signature = JSON.stringify(build?.signature)
    const unsigned = signature === JSON.stringify(unsignedSignature)
    const linkerAdhoc = signature === JSON.stringify(linkerAdhocSignature)
    if (
      build?.platform !== expectedPlatform ||
      (!unsigned && !(kind === 'simulator' && linkerAdhoc)) ||
      build.unsigned !== unsigned ||
      build.provisioned !== false ||
      JSON.stringify(build.architectures) !== JSON.stringify(expectedArchitectures) ||
      !build.executable ||
      basename(build.executable) !== build.executable ||
      receipt.files.filter(
        (entry) =>
          entry.kind === kind && entry.name === name && entry.sha256 === sha256(readFileSync(file))
      ).length !== 1
    ) {
      throw new Error(`iOS ${kind} verification or checksum differs`)
    }
    await verifyTar(
      context,
      file,
      kind === 'archive' ? `${scheme}.xcarchive` : `${scheme}.app`,
      build.executable,
      kind === 'archive'
    )
    files.push({ source: file, name })
  }
  files.push({ source: join(source, verificationName), name: verificationName })
  return {
    files,
    signature: {
      status: 'not-distribution-signed',
      archive: receipt.builds.archive.signature,
      simulator: receipt.builds.simulator.signature,
      deviceInstallable: false,
      ipaProduced: false
    },
    ios: { identity: receipt.identity, builds: receipt.builds, toolchain: receipt.toolchain }
  }
}
