import { createHash } from 'node:crypto'

function positiveBuild(value, name) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return number
}

export function releaseBatchPlan({
  pkg,
  mobile,
  app,
  client,
  sourceCommit,
  channel,
  targets = 'all'
}) {
  if (!['all', 'linux-android'].includes(targets)) {
    throw new Error('Release targets must be all or linux-android')
  }
  const version = pkg.version
  const segment = '(?:0|[1-9]\\d*)'
  const pattern = new RegExp(
    `^${segment}\\.${segment}\\.${segment}${channel === 'beta' ? `-beta\\.${segment}` : ''}$`
  )
  if (!['beta', 'stable'].includes(channel) || !pattern.test(version)) {
    throw new Error('Committed product version does not match the release channel')
  }
  if (mobile.version !== version || app.expo?.version !== version) {
    throw new Error('All committed client product versions must agree')
  }
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sourceCommit ?? '')) {
    throw new Error('A frozen full source commit is required')
  }
  positiveBuild(client.desktopBuildNumber, 'desktopBuildNumber')
  const artifact = (architecture, packageFormat, distributionType = 'DIRECT') => ({
    architecture,
    packageFormat,
    distributionType
  })
  const platforms = [
    { platform: 'WINDOWS', artifacts: [artifact('X64', 'NSIS')] },
    { platform: 'MACOS', artifacts: ['X64', 'ARM64'].map((arch) => artifact(arch, 'ZIP')) },
    {
      platform: 'LINUX',
      artifacts: ['X64', 'ARM64'].flatMap((arch) =>
        ['APPIMAGE', 'DEB', 'TAR_GZ'].map((format) => artifact(arch, format))
      )
    },
    {
      platform: 'ANDROID',
      requestedBuildNumber: positiveBuild(app.expo.android?.versionCode, 'Android versionCode'),
      artifacts: [artifact('UNIVERSAL', 'APK')]
    },
    {
      platform: 'IOS',
      requestedBuildNumber: positiveBuild(app.expo.ios?.buildNumber, 'iOS buildNumber'),
      artifacts: [artifact('ANY', 'STORE_LINK', channel === 'beta' ? 'TESTFLIGHT' : 'APP_STORE')]
    }
  ]
  const selected =
    targets === 'all'
      ? platforms
      : platforms.filter(({ platform }) => ['LINUX', 'ANDROID'].includes(platform))
  const identity = {
    product: 'hivecode',
    channel,
    versionName: version,
    sourceCommit,
    targets,
    platforms: selected
  }
  return {
    ...identity,
    idempotencyKey: `hivecode:${channel}:${version}:${targets === 'all' ? '' : `${targets}:`}${sourceCommit}`,
    manifestSha256: createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  }
}

export function artifactIdentity(artifact) {
  return ['architecture', 'packageFormat', 'distributionType']
    .map((field) => String(artifact[field]).toUpperCase())
    .join('/')
}

export function assertBatchPlan(batch, plan, members) {
  if (
    batch?.productCode !== plan.product ||
    String(batch.channel).toLowerCase() !== plan.channel ||
    batch.versionName !== plan.versionName ||
    batch.sourceCommit !== plan.sourceCommit ||
    batch.idempotencyKey !== plan.idempotencyKey ||
    !['DRAFT', 'PUBLISHED'].includes(String(batch.status).toUpperCase()) ||
    batch.releases?.length !== members.length
  ) {
    throw new Error('HiveCloud batch identity differs from the frozen release plan')
  }
  for (const member of members) {
    const actual = batch.releases.find((entry) => entry.releaseId === member.releaseId)
    const expected = member.artifacts.map(artifactIdentity).sort()
    if (
      !actual ||
      String(actual.platform).toUpperCase() !== member.platform ||
      Number(actual.buildNumber) !== member.buildNumber ||
      JSON.stringify(actual.artifacts?.map(artifactIdentity).sort()) !== JSON.stringify(expected)
    ) {
      throw new Error(`HiveCloud batch matrix differs for ${member.platform}`)
    }
  }
}
