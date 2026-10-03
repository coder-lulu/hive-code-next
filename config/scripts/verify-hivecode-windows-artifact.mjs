import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  parseExpectedSigners,
  parseExpectedThumbprints,
  verifyWindowsInnerSignature
} from './verify-windows-inner-signature.mjs'

export function verifyHiveCodeWindowsArtifacts(
  artifacts,
  {
    expectedSigners = process.env.HIVECODE_WINDOWS_EXPECTED_SIGNERS,
    expectedThumbprints = process.env.HIVECODE_WINDOWS_EXPECTED_THUMBPRINTS,
    powershellExecutable = process.env.HIVECODE_WINDOWS_POWERSHELL_EXECUTABLE,
    verifyImpl = verifyWindowsInnerSignature
  } = {}
) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('Usage: pnpm verify:windows:hardware <artifact.exe> [artifact.exe ...]')
  }
  if (!expectedSigners?.trim() && !expectedThumbprints?.trim()) {
    throw new Error('An expected Windows signer subject or thumbprint is required.')
  }

  const signerAllowlist = expectedSigners?.trim() ? parseExpectedSigners(expectedSigners) : []
  const thumbprintAllowlist = parseExpectedThumbprints(expectedThumbprints)
  return artifacts.map((artifact) => {
    const artifactPath = resolve(artifact)
    verifyImpl({
      executablePath: artifactPath,
      powershellExecutable,
      expectedSigners: signerAllowlist,
      expectedThumbprints: thumbprintAllowlist
    })
    return artifactPath
  })
}

export function main(argv = process.argv.slice(2)) {
  try {
    for (const artifact of verifyHiveCodeWindowsArtifacts(argv)) {
      console.log(`Verified HiveCode Windows artifact: ${artifact}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
