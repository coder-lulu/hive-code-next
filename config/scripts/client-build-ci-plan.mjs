import { pathToFileURL } from 'node:url'

export const ciTargets = [
  { target: 'windows-x64', runner: 'windows-2022' },
  { target: 'macos-x64', runner: 'macos-15-intel' },
  { target: 'macos-arm64', runner: 'macos-15' },
  { target: 'linux-x64', runner: 'ubuntu-22.04' },
  { target: 'linux-arm64', runner: 'ubuntu-22.04-arm' },
  { target: 'android', runner: 'ubuntu-22.04' },
  { target: 'ios', runner: 'macos-26' }
]

export function buildMatrix(selection = 'all') {
  const include = ciTargets.filter(({ target }) => selection === 'all' || target === selection)
  if (!include.length) {
    throw new Error(`Unsupported client build target: ${selection}`)
  }
  return { include }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(buildMatrix(process.env.BUILD_TARGET || 'all')))
}
