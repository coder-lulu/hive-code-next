import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readJson } from './client-build-contract.mjs'
import { acquireBuildLock } from './client-build-execution.mjs'

const root = resolve(import.meta.dirname, '../..')
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    version: { type: 'string' },
    'desktop-build': { type: 'string' },
    'android-code': { type: 'string' },
    'ios-build': { type: 'string' }
  }
})
const unlock = acquireBuildLock(root)
try {
  const files = [
    'package.json',
    'mobile/package.json',
    'mobile/app.json',
    'config/client-build.json'
  ]
  const [pkg, mobile, app, config] = files.map((file) => readJson(join(root, file)))
  if (!/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/.test(values.version || '')) {
    throw new Error('--version must be x.y.z or x.y.z-beta.n/rc.n')
  }
  const desktop = Number(values['desktop-build'])
  const android = Number(values['android-code'])
  if (
    !Number.isSafeInteger(desktop) ||
    desktop <= config.desktopBuildNumber ||
    !Number.isSafeInteger(android) ||
    android <= app.expo.android.versionCode
  ) {
    throw new Error('Specify strictly increasing --desktop-build and --android-code')
  }
  if (
    values['ios-build'] &&
    (!/^\d+$/.test(values['ios-build']) ||
      Number(values['ios-build']) <= Number(app.expo.ios.buildNumber))
  ) {
    throw new Error('--ios-build must increase')
  }
  pkg.version = mobile.version = app.expo.version = values.version
  app.expo.android.versionCode = android
  if (values['ios-build']) {
    app.expo.ios.buildNumber = values['ios-build']
  }
  config.desktopBuildNumber = desktop
  config.channel = values.version.includes('-beta.')
    ? 'beta'
    : values.version.includes('-rc.')
      ? 'rc'
      : 'stable'
  for (const [index, value] of [pkg, mobile, app, config].entries()) {
    writeFileSync(join(root, files[index]), `${JSON.stringify(value, null, 2)}\n`)
  }
  console.log(
    `Client versions updated to ${values.version}. Run clients:prepare before building; retries do not change versions.`
  )
} finally {
  unlock()
}
